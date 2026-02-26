/**
 * Document Persistence Layer
 * Saves Yjs document state to Supabase for cloud backup and cross-device sync
 * Database is just dumb storage - CRDT handles all merging via real-time sync
 */

import * as Y from 'yjs';
import { supabase } from '../config/supabase';
import { logger } from './logger';

const SAVE_DEBOUNCE_MS = 800; // Save quickly for faster cross-peer sync

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds
const MAX_RETRY_DELAY = 30000; // 30 seconds

// Safe base64 encoding for large Uint8Arrays (avoids stack overflow)
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// Safe base64 decoding — returns null on corrupted data instead of crashing
function safeBase64Decode(base64: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// Version snapshot configuration
const SNAPSHOT_EVERY_N_SAVES = 5; // Take snapshot every 5th save
const SNAPSHOT_EVERY_SECONDS = 120; // OR every 2 minutes (120 seconds)

export type SaveStatus = 'saving' | 'saved' | 'error';

export class DocumentPersistence {
  private doc: Y.Doc;
  private documentId: string;
  private saveTimeout: NodeJS.Timeout | null = null;
  private isSaving = false;
  private saveCount: number = 0; // Track number of saves for snapshot sampling
  private lastKnownVersion: number = 0; // Track server version to pass conflict check
  private pendingSave: boolean = false; // True if a save was requested while another was in progress
  private pollTimer: NodeJS.Timeout | null = null;

  // Event emitter
  private eventHandlers: Map<string, Set<Function>> = new Map();

  // Retry state
  private retryCount: number = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private lastErrorMessage: string | null = null;

  constructor(doc: Y.Doc, roomId: string = 'default') {
    this.doc = doc;
    this.documentId = `room-${roomId}`; // Each room has its own document
  }

  // Event emitter methods (matching SimpleSupabaseProvider's pattern)
  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: Function): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private emit(event: string, ...args: any[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(...args));
    }
  }

  /**
   * Load document state from Supabase using RPC
   * Returns true if state was loaded, false if no saved state exists
   */
  async loadFromDatabase(): Promise<boolean> {
    try {
      logger.log('💾 Loading document from Supabase...');

      const { data, error } = await supabase.rpc('get_document', {
        p_document_id: this.documentId,
      });

      if (error) {
        logger.error('❌ RPC error:', error);
        return false;
      }

      if (!data || !Array.isArray(data) || data.length === 0) {
        logger.log('📄 No saved document found, starting fresh');
        return false;
      }

      // get_document returns TABLE, so data is an array - use first row
      const doc = data[0];

      if (doc.yjs_state) {
        // Decode base64 and apply state
        const stateVector = safeBase64Decode(doc.yjs_state);
        if (!stateVector) {
          logger.error('❌ Corrupted base64 state in database');
          return false;
        }
        Y.applyUpdate(this.doc, stateVector, this);

        // Track the server version so saves pass the conflict check
        if (doc.version) {
          this.lastKnownVersion = doc.version;
        }

        logger.log('✅ Loaded document from database');
        logger.log('   Last updated:', doc.updated_at, '| Version:', doc.version || 'unknown');
        logger.log('   Content length:', this.doc.getText('content').length, 'chars');
        return true;
      }

      return false;
    } catch (error) {
      logger.error('❌ Error loading document:', error);
      return false;
    }
  }

  /**
   * Save document state to Supabase (debounced)
   */
  scheduleSave(): void {
    // Clear existing timeout
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // Cancel any pending retry — new edit means a new save will include all state
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    // Schedule new save
    this.saveTimeout = setTimeout(() => {
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Immediately save local state to database.
   * Does NOT load/merge DB state first — that caused content duplication.
   */
  async saveNow(): Promise<void> {
    if (this.isSaving) {
      logger.log('⏸️  Save already in progress, queuing follow-up');
      this.pendingSave = true;
      return;
    }

    this.isSaving = true;
    this.emit('save-status', { status: 'saving' as SaveStatus });

    try {
      // GUARD: Never save an empty document — this would overwrite real content
      // in Supabase. If the doc is empty, something went wrong with loading.
      const xmlFragment = this.doc.getXmlFragment('prosemirror');
      const ytext = this.doc.getText('content');
      const textContent = ytext.toString();

      if (xmlFragment.length === 0 && textContent.length === 0) {
        logger.warn('🛡️ BLOCKED: Refusing to save empty document — would overwrite server data');
        this.emit('save-status', { status: 'saved' as SaveStatus });
        return;
      }

      // Save local state directly to database — NO merge-on-save.
      // Real-time sync via the provider handles conflict resolution.
      // Merging DB state before saving causes CRDT lineage divergence
      // which duplicates content (the #1 cause of the 530→332 card bug).
      const stateVector = Y.encodeStateAsUpdate(this.doc);
      const base64State = uint8ArrayToBase64(stateVector);

      logger.log('💾 Saving document to Supabase...', textContent.length, 'characters');
      logger.log('   Content preview:', textContent.substring(0, 100) + (textContent.length > 100 ? '...' : ''));

      // Increment save counter
      this.saveCount++;

      // Use RPC to save current state.
      // p_min_version uses the last known server version so the RPC's
      // conflict check (v_current_version > p_min_version) passes.
      // CRDT handles merge conflicts — the version check is just for
      // ordering, not for rejecting writes.
      const { data, error } = await supabase.rpc('upsert_document_rpc', {
        p_id: this.documentId,
        p_title: 'Main Document',
        p_owner_id: sessionStorage.getItem('flashy_user_id') || null,
        p_yjs_state_base64: base64State,
        p_content_text: textContent,
        p_last_edited_by: sessionStorage.getItem('flashy_username') || 'anonymous',
        p_min_version: this.lastKnownVersion, // Pass last known version so conflict check passes
        p_snapshot_every_n: SNAPSHOT_EVERY_N_SAVES,
        p_snapshot_every_seconds: SNAPSHOT_EVERY_SECONDS,
      });

      if (error) {
        logger.error('❌ Save failed (RPC error):', error);
        this.handleSaveError(error.message || 'Save failed');
        return;
      }

      // Check the RPC's success field — it returns {success: false} on conflict
      if (data && data.success === false) {
        logger.warn('⚠️ Save rejected by server:', data.message);
        // Update our known version so the next save passes
        if (data.server_version) {
          this.lastKnownVersion = data.server_version;
        }
        // Don't treat as error — just retry with updated version
        this.scheduleSave();
        return;
      }

      if (data) {
        logger.log('✅ Document saved successfully');
        logger.log('   Status:', data.message);
        // Track server version for future saves
        if (data.server_version) {
          this.lastKnownVersion = data.server_version;
        }
        if (data.message?.includes('snapshot')) {
          logger.log('📸 Version snapshot created!');
        }
      }

      // Success — reset retry state
      this.retryCount = 0;
      this.lastErrorMessage = null;
      this.emit('save-status', { status: 'saved' as SaveStatus });
    } catch (error: any) {
      logger.error('❌ Error saving document:', error);
      this.handleSaveError(error?.message || 'Network error');
    } finally {
      this.isSaving = false;
      // If a save was requested while we were saving, schedule it now
      if (this.pendingSave) {
        this.pendingSave = false;
        this.scheduleSave();
      }
    }
  }

  /**
   * Handle a failed save — emit error and schedule retry with exponential backoff
   */
  private handleSaveError(message: string): void {
    this.lastErrorMessage = message;
    this.emit('save-status', { status: 'error' as SaveStatus, message });

    if (this.retryCount < MAX_RETRIES) {
      const delay = Math.min(
        INITIAL_RETRY_DELAY * Math.pow(2, this.retryCount),
        MAX_RETRY_DELAY
      );
      this.retryCount++;
      logger.log(`🔄 Retrying save in ${delay}ms (attempt ${this.retryCount}/${MAX_RETRIES})`);

      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.saveNow();
      }, delay);
    } else {
      logger.error('❌ Max save retries reached — giving up until next edit');
    }
  }

  /**
   * Start auto-saving when document changes
   */
  enableAutoSave(remoteOrigins?: any[]): void {
    logger.log('🔄 Auto-save enabled (saves on LOCAL changes only)');

    this.doc.on('update', (_update: Uint8Array, origin: any) => {
      // CRITICAL: Only save on LOCAL edits, NOT remote updates.
      // Without this check, every keystroke from any user triggers saves
      // on ALL connected clients (N users = N saves per edit), which
      // hammers Supabase and caused the 100% CPU spike.
      //
      // Remote origins: the SimpleSupabaseProvider instance (passed as `this`
      // in Y.applyUpdate calls), or the DocumentPersistence instance itself
      // (when loading from DB).
      if (origin != null && (origin === this || (remoteOrigins && remoteOrigins.includes(origin)))) {
        return; // Remote update — don't save, the sender will save their own state
      }
      this.scheduleSave();
    });
  }

  /**
   * Get version history for this document
   */
  async getVersionHistory(limit: number = 10): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('document_versions')
        .select('version, created_at, last_edited_by')
        .eq('document_id', this.documentId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data || [];
    } catch (error) {
      logger.error('❌ Error fetching version history:', error);
      return [];
    }
  }

  /**
   * Restore document to a specific version
   */
  async restoreVersion(targetVersion: number): Promise<boolean> {
    try {
      logger.log('🔄 Restoring to version:', targetVersion);

      const { data, error } = await supabase
        .from('document_versions')
        .select('yjs_state')
        .eq('document_id', this.documentId)
        .eq('version', targetVersion)
        .single();

      if (error) throw error;

      if (data && data.yjs_state) {
        // Decode and apply the historical state
        const stateVector = safeBase64Decode(data.yjs_state);
        if (!stateVector) {
          logger.error('❌ Corrupted version snapshot');
          return false;
        }

        // Clear current state and apply historical state
        this.doc.transact(() => {
          const ytext = this.doc.getText('content');
          ytext.delete(0, ytext.length);
          Y.applyUpdate(this.doc, stateVector);
        });

        logger.log('✅ Restored to version:', targetVersion);

        // Save the restored version as current
        await this.saveNow();

        return true;
      }

      return false;
    } catch (error) {
      logger.error('❌ Error restoring version:', error);
      return false;
    }
  }

  /**
   * Start polling — DISABLED.
   * Polling applied full DB state via Y.applyUpdate every few seconds,
   * which caused CRDT lineage divergence and content duplication.
   * Real-time sync via the provider is the only safe sync mechanism.
   * Initial load from DB happens once in loadFromDatabase().
   */
  startPolling(_intervalMs: number = 15_000): void {
    // No-op — polling removed to prevent merge-induced duplication.
    // Real-time provider handles sync; initial load handles cold start.
  }

  /**
   * Stop database polling (when realtime channel recovers)
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      logger.log('📡 Database polling stopped (channel recovered)');
    }
  }

  /**
   * Clean up
   */
  destroy(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.stopPolling();
  }
}
