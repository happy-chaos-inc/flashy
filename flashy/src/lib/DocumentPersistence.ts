/**
 * Document Persistence Layer
 * Saves Yjs document state to Supabase for cloud backup and cross-device sync
 * Database is just dumb storage - CRDT handles all merging via real-time sync
 */

import * as Y from 'yjs';
import { supabase } from '../config/supabase';
import { logger } from './logger';

const SAVE_DEBOUNCE_MS = 800; // Save quickly for faster cross-peer sync

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

// Version snapshot configuration
const SNAPSHOT_EVERY_N_SAVES = 5; // Take snapshot every 5th save
const SNAPSHOT_EVERY_SECONDS = 120; // OR every 2 minutes (120 seconds)

export class DocumentPersistence {
  private doc: Y.Doc;
  private documentId: string;
  private saveTimeout: NodeJS.Timeout | null = null;
  private isSaving = false;
  private saveCount: number = 0; // Track number of saves for snapshot sampling
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(doc: Y.Doc, roomId: string = 'default') {
    this.doc = doc;
    this.documentId = `room-${roomId}`; // Each room has its own document
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
        const stateVector = Uint8Array.from(atob(doc.yjs_state), c => c.charCodeAt(0));
        Y.applyUpdate(this.doc, stateVector);

        logger.log('✅ Loaded document from database');
        logger.log('   Last updated:', doc.updated_at);
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

    // Schedule new save
    this.saveTimeout = setTimeout(() => {
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Immediately save to database with proper CRDT merge
   * Loads database state, merges with local, then saves result
   */
  async saveNow(): Promise<void> {
    if (this.isSaving) {
      logger.log('⏸️  Save already in progress, skipping');
      return;
    }

    this.isSaving = true;

    try {
      const localLength = this.doc.getText('content').length;

      // STEP 1: Load latest from database and merge (in case we missed real-time updates)
      try {
        const { data } = await supabase.rpc('get_document', {
          p_document_id: this.documentId,
        });

        if (data && data[0]?.yjs_state) {
          const dbState = Uint8Array.from(atob(data[0].yjs_state), c => c.charCodeAt(0));
          // Merge database state with local - CRDT handles conflicts
          Y.applyUpdate(this.doc, dbState);

          const mergedLength = this.doc.getText('content').length;
          if (mergedLength !== localLength) {
            logger.log('🔀 Merged database changes before saving:', localLength, '→', mergedLength, 'chars');
          }
        }
      } catch (mergeError) {
        logger.warn('⚠️  Could not merge database state (continuing with local):', mergeError);
      }

      // STEP 2: Get merged Yjs state
      const stateVector = Y.encodeStateAsUpdate(this.doc);
      const base64State = uint8ArrayToBase64(stateVector);

      // Get text content for searching/preview
      const ytext = this.doc.getText('content');
      const textContent = ytext.toString();

      logger.log('💾 Saving document to Supabase...', textContent.length, 'characters');
      logger.log('   Content preview:', textContent.substring(0, 100) + (textContent.length > 100 ? '...' : ''));

      // Increment save counter
      this.saveCount++;

      // Use RPC to save current state (no version checking - CRDT handles conflicts)
      const { data, error } = await supabase.rpc('upsert_document_rpc', {
        p_id: this.documentId,
        p_title: 'Main Document',
        p_owner_id: sessionStorage.getItem('flashy_user_id') || null,
        p_yjs_state_base64: base64State,
        p_content_text: textContent,
        p_last_edited_by: sessionStorage.getItem('flashy_username') || 'anonymous',
        p_min_version: 0, // No conflict checking - always accept
        p_snapshot_every_n: SNAPSHOT_EVERY_N_SAVES, // Take snapshot every 10 saves
        p_snapshot_every_seconds: SNAPSHOT_EVERY_SECONDS, // OR every 5 minutes
      });

      if (error) {
        logger.error('❌ Save failed:', error);
        return;
      }

      if (data) {
        logger.log('✅ Document saved successfully');
        logger.log('   Status:', data.message);

        // Log if snapshot was created
        if (data.message?.includes('snapshot')) {
          logger.log('📸 Version snapshot created!');
        }
      }
    } catch (error) {
      logger.error('❌ Error saving document:', error);
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Start auto-saving when document changes
   */
  enableAutoSave(): void {
    logger.log('🔄 Auto-save enabled (saves 2s after changes)');

    this.doc.on('update', () => {
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
        const stateVector = Uint8Array.from(atob(data.yjs_state), c => c.charCodeAt(0));

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
   * Start polling the database for updates (fallback when realtime channel is down)
   * Loads latest state and merges with local Y.Doc every interval
   */
  startPolling(intervalMs: number = 15_000): void {
    this.stopPolling();
    logger.log('📡 Database polling started (channel fallback, every', intervalMs / 1000, 's)');

    this.pollTimer = setInterval(async () => {
      try {
        const { data, error } = await supabase.rpc('get_document', {
          p_document_id: this.documentId,
        });

        if (error || !data || !Array.isArray(data) || data.length === 0) return;

        const doc = data[0];
        if (doc.yjs_state) {
          const stateVector = Uint8Array.from(atob(doc.yjs_state), c => c.charCodeAt(0));
          Y.applyUpdate(this.doc, stateVector);
        }
      } catch {
        // Non-critical — will retry on next interval
      }
    }, intervalMs);
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
    this.stopPolling();
  }
}
