// Singleton manager for collaboration
import * as Y from 'yjs';
import { Doc } from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { SimpleSupabaseProvider } from './SimpleSupabaseProvider';
import { DocumentPersistence } from './DocumentPersistence';
import { supabase } from '../config/supabase';
import { generateUserInfo } from './userColors';

class CollaborationManager {
  private static instance: CollaborationManager | null = null;
  private ydoc: Doc | null = null;
  private provider: SimpleSupabaseProvider | null = null;
  private indexeddbProvider: IndexeddbPersistence | null = null;
  public persistence: DocumentPersistence | null = null; // Public for version history UI
  private refCount: number = 0;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private dbLoaded: boolean = false;
  private dbLoadPromise: Promise<void> | null = null;
  private userInfo: { userId: string; color: string; name: string } | null = null;

  private constructor() {}

  static getInstance(): CollaborationManager {
    if (!CollaborationManager.instance) {
      CollaborationManager.instance = new CollaborationManager();
    }
    return CollaborationManager.instance;
  }

  async connect(): Promise<{ ydoc: Doc; provider: SimpleSupabaseProvider; userInfo: { userId: string; color: string; name: string } }> {
    this.refCount++;
    console.log('📊 CollaborationManager.connect() - refCount:', this.refCount);

    // Cancel any pending cleanup
    if (this.cleanupTimer) {
      console.log('⏸️  Canceling scheduled cleanup (component remounted)');
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Create only once, reuse on subsequent calls
    if (!this.ydoc || !this.provider) {
      console.log('🆕 Creating new Yjs doc and provider');

      this.ydoc = new Doc();

      // Check if IndexedDB is stale (older than 1 hour)
      const lastVisit = localStorage.getItem('flashy_last_visit');
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      if (lastVisit && (now - parseInt(lastVisit)) > oneHour) {
        console.log('🧹 IndexedDB is stale (>1hr old), clearing...');
        indexedDB.deleteDatabase('flashy-doc');
        console.log('✅ Stale IndexedDB cleared - will load fresh from database');
      }

      // Update last visit timestamp
      localStorage.setItem('flashy_last_visit', now.toString());

      // Add IndexedDB persistence for instant local sync
      this.indexeddbProvider = new IndexeddbPersistence('flashy-doc', this.ydoc);
      this.indexeddbProvider.on('synced', () => {
        console.log('💾 IndexedDB synced - local data loaded');
      });

      // Create provider for real-time sync
      this.provider = new SimpleSupabaseProvider(this.ydoc, supabase, 'collaboration-room');

      // Add database persistence for cloud backup (just dumb storage)
      this.persistence = new DocumentPersistence(this.ydoc);

      // Load from database (store promise so we can wait for it)
      this.dbLoadPromise = this.loadFromDatabase();

      // Connect first to sync awareness states
      this.provider.connect();

      // Wait for initial awareness sync, then check room capacity
      await this.checkRoomCapacity();

      // Set user info with color for CodeMirror cursors (SINGLE SOURCE OF TRUTH)
      this.userInfo = generateUserInfo();
      console.log('👤 User info:', this.userInfo);
      this.provider.awareness.setLocalStateField('user', {
        name: this.userInfo.name,
        color: this.userInfo.color,
        colorLight: this.userInfo.color + '40', // Add transparency for selections
      });
    } else {
      console.log('♻️  Reusing existing Yjs doc and provider');

      // Make sure provider is connected
      if (!this.provider.connected) {
        console.log('🔌 Reconnecting provider...');
        this.provider.connect();
      }

      // Ensure userInfo is set (should be from first connect)
      if (!this.userInfo) {
        this.userInfo = generateUserInfo();
      }
    }

    return { ydoc: this.ydoc, provider: this.provider, userInfo: this.userInfo! };
  }

  /**
   * Wait for database to finish loading before enabling editor
   * This ensures new browsers get the latest content before allowing edits
   */
  async waitForDatabaseSync(): Promise<void> {
    if (this.dbLoadPromise) {
      await this.dbLoadPromise;
    }
  }

  /**
   * Check if room is at capacity (max 8 users)
   * Waits for initial awareness sync, then checks count
   */
  private async checkRoomCapacity(): Promise<void> {
    if (!this.provider) return;

    const MAX_USERS = 8;

    // Wait for initial awareness sync (500ms should be enough)
    await new Promise(resolve => setTimeout(resolve, 500));

    const currentUsers = this.provider.awareness.getStates().size;
    console.log(`👥 Current users in room: ${currentUsers}/${MAX_USERS}`);

    if (currentUsers >= MAX_USERS) {
      console.error('❌ Room is full! Cannot join.');
      // Disconnect immediately
      this.provider.disconnect();
      this.provider.destroy();
      this.provider = null;
      this.ydoc = null;
      throw new Error('ROOM_FULL');
    }
  }

  private async loadFromDatabase(): Promise<void> {
    if (this.dbLoaded || !this.persistence || !this.ydoc) return;

    try {
      console.log('🔄 Merging CRDT states: IndexedDB + Database...');

      // Get IndexedDB state BEFORE loading database
      // This preserves any local offline edits
      const indexedDBLength = this.ydoc.getText('content').length;

      console.log('📊 IndexedDB state:', indexedDBLength, 'chars');

      // Load from database - this will MERGE with IndexedDB via CRDT
      const loaded = await this.persistence.loadFromDatabase();
      this.dbLoaded = true;

      const finalLength = this.ydoc.getText('content').length;

      if (loaded) {
        console.log('✅ CRDT merge complete!');
        console.log('   IndexedDB had:', indexedDBLength, 'chars');
        console.log('   Merged result:', finalLength, 'chars');

        // If merged result is different, it means we had offline edits
        if (finalLength > indexedDBLength) {
          console.log('🔀 Database had newer content - merged via CRDT');
        } else if (finalLength < indexedDBLength) {
          console.log('🔀 IndexedDB had newer content - merged via CRDT');
        } else if (indexedDBLength > 0) {
          console.log('✓ Both sources had same content');
        }
      } else {
        console.log('📝 No database content, using IndexedDB state only');
      }

      // Enable auto-save after loading
      this.persistence.enableAutoSave();

      // Add save-on-close to prevent data loss
      this.addBeforeUnloadHandler();
    } catch (error) {
      console.error('❌ Failed to load from database:', error);
      // Continue anyway - IndexedDB might have data
      this.persistence?.enableAutoSave();
    }
  }

  private addBeforeUnloadHandler(): void {
    window.addEventListener('beforeunload', () => {
      console.log('⚠️ Browser closing - forcing final save and cleanup...');

      // Remove our awareness state immediately so others see us leave
      if (this.provider) {
        this.provider.awareness.setLocalState(null);
      }

      if (this.persistence) {
        // Force immediate save (not async - browser might kill us)
        this.persistence.saveNow();
      }
    });
  }

  disconnect(): void {
    this.refCount--;
    console.log('📊 CollaborationManager.disconnect() - refCount:', this.refCount);

    // Don't destroy immediately - allow for quick remounts
    if (this.refCount <= 0) {
      console.log('⏳ Scheduling cleanup in 2s (in case of remount)...');

      this.cleanupTimer = setTimeout(() => {
        if (this.refCount <= 0) {
          console.log('🧹 Cleaning up provider (confirmed no active references)');

          // Final save before cleanup
          if (this.persistence) {
            this.persistence.saveNow();
            this.persistence.destroy();
          }

          this.indexeddbProvider?.destroy();
          this.provider?.destroy();
          this.indexeddbProvider = null;
          this.provider = null;
          this.persistence = null;
          this.ydoc = null;
          this.refCount = 0;
          this.cleanupTimer = null;
          this.dbLoaded = false;
        } else {
          console.log('♻️  Provider still in use, skipping cleanup');
        }
      }, 2000);
    }
  }
}

export const collaborationManager = CollaborationManager.getInstance();
