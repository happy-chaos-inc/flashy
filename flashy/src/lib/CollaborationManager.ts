// Singleton manager for collaboration
import { Doc, Text as YText, Array as YArray, XmlElement } from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { SimpleSupabaseProvider } from './SimpleSupabaseProvider';
import { DocumentPersistence } from './DocumentPersistence';
import { supabase } from '../config/supabase';
import { generateUserInfo } from './userColors';
import { logger } from './logger';

// Chat message schema for collaborative AI chat
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  author?: { name: string; color: string };  // For user messages
  timestamp: number;
}

// Shared attachment metadata - just names, not the actual data
export interface SharedAttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
  ownerId: number;  // clientID of the peer who has this file
  ownerName: string;
  embeddingStatus?: 'pending' | 'processing' | 'ready' | 'error';
}

// Chat thread metadata for multi-chat support
export interface ChatThread {
  id: string;
  name: string;
  model?: string;
  provider?: 'openai' | 'anthropic';
  createdAt: number;
}

// Send request - when someone presses Enter, this triggers the peer with files to send
export interface SendRequest {
  id: string;
  prompt: string;
  requestedBy: number;  // clientID who pressed Enter
  timestamp: number;
}

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
  private currentRoomId: string | null = null;
  private connectPromise: Promise<{ ydoc: Doc; provider: SimpleSupabaseProvider; userInfo: { userId: string; color: string; name: string } }> | null = null;
  private colorChangeListeners: Set<(color: string) => void> = new Set();

  private constructor() {}

  static getInstance(): CollaborationManager {
    if (!CollaborationManager.instance) {
      CollaborationManager.instance = new CollaborationManager();
    }
    return CollaborationManager.instance;
  }

  /**
   * Get the current room ID
   */
  getRoomId(): string | null {
    return this.currentRoomId;
  }

  async connect(roomId?: string): Promise<{ ydoc: Doc; provider: SimpleSupabaseProvider; userInfo: { userId: string; color: string; name: string } }> {
    // If no roomId provided and we're already connected, reuse existing connection
    if (!roomId && this.currentRoomId && this.ydoc && this.provider) {
      roomId = this.currentRoomId;
    }
    // Default to 'default' if still no roomId
    if (!roomId) {
      roomId = 'default';
    }

    this.refCount++;
    logger.log(`📊 CollaborationManager.connect(${roomId}) - refCount:`, this.refCount);

    // Cancel any pending cleanup
    if (this.cleanupTimer) {
      logger.log('⏸️  Canceling scheduled cleanup (component remounted)');
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // If switching rooms, force cleanup first
    if (this.currentRoomId && this.currentRoomId !== roomId && this.ydoc) {
      logger.log(`🔄 Switching rooms: ${this.currentRoomId} → ${roomId}`);
      this.forceCleanup();
      this.connectPromise = null; // Reset promise when switching rooms
    }

    // If already connected to this room, return existing connection
    if (this.ydoc && this.provider && this.userInfo && this.currentRoomId === roomId) {
      logger.log('♻️  Reusing existing Yjs doc and provider');

      // Make sure provider is connected
      if (!this.provider.connected) {
        logger.log('🔌 Reconnecting provider...');
        this.provider.connect();
      }

      return { ydoc: this.ydoc, provider: this.provider, userInfo: this.userInfo };
    }

    // If connection is in progress, wait for it
    if (this.connectPromise) {
      logger.log('⏳ Connection in progress, waiting...');
      return this.connectPromise;
    }

    // Start new connection
    this.connectPromise = this.doConnect(roomId);
    try {
      return await this.connectPromise;
    } finally {
      // Don't clear connectPromise - keep it for subsequent calls
    }
  }

  private async doConnect(roomId: string): Promise<{ ydoc: Doc; provider: SimpleSupabaseProvider; userInfo: { userId: string; color: string; name: string } }> {
    // Create only once
    if (!this.ydoc || !this.provider) {
      logger.log(`🆕 Creating new Yjs doc and provider for room: ${roomId}`);
      this.currentRoomId = roomId;

      this.ydoc = new Doc();

      // Check if IndexedDB is stale (older than 1 hour)
      const lastVisitKey = `flashy_last_visit_${roomId}`;
      const lastVisit = localStorage.getItem(lastVisitKey);
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;

      const indexedDbName = `flashy-doc-${roomId}`;
      if (lastVisit && (now - parseInt(lastVisit)) > oneHour) {
        logger.log('🧹 IndexedDB is stale (>1hr old), clearing...');
        indexedDB.deleteDatabase(indexedDbName);
        logger.log('✅ Stale IndexedDB cleared - will load fresh from database');
      }

      // Update last visit timestamp
      localStorage.setItem(lastVisitKey, now.toString());

      // Add IndexedDB persistence for instant local sync (per room)
      this.indexeddbProvider = new IndexeddbPersistence(indexedDbName, this.ydoc);
      this.indexeddbProvider.on('synced', () => {
        logger.log('💾 IndexedDB synced - local data loaded');
      });

      // Create provider for real-time sync (channel per room)
      const channelName = `room-${roomId}`;
      this.provider = new SimpleSupabaseProvider(this.ydoc, supabase, channelName);

      // Add database persistence for cloud backup (per room)
      this.persistence = new DocumentPersistence(this.ydoc, roomId);

      // Load from database (store promise so we can wait for it)
      this.dbLoadPromise = this.loadFromDatabase();

      // Connect first to sync awareness states
      this.provider.connect();

      // Wait for initial awareness sync, then check room capacity
      await this.checkRoomCapacity();

      // Set user info with color for CodeMirror cursors (SINGLE SOURCE OF TRUTH)
      this.userInfo = generateUserInfo();

      // Check if our color is already in use by another user
      const usedColors = this.getUsedColors();
      if (usedColors.includes(this.userInfo.color.toUpperCase())) {
        // Find an available color
        const { USER_COLORS } = await import('./userColors');
        const availableColor = USER_COLORS.find(
          c => !usedColors.includes(c.toUpperCase())
        );
        if (availableColor) {
          this.userInfo.color = availableColor;
          sessionStorage.setItem('flashy_user_color', availableColor);
          logger.log('🎨 Assigned available color:', availableColor);
        }
      }

      logger.log('👤 User info:', this.userInfo);
      this.provider.awareness.setLocalStateField('user', {
        name: this.userInfo.name,
        color: this.userInfo.color,
        colorLight: this.userInfo.color + '40', // Add transparency for selections
      });
    }

    return { ydoc: this.ydoc!, provider: this.provider!, userInfo: this.userInfo! };
  }

  /**
   * Force cleanup without waiting - used when switching rooms
   */
  private forceCleanup(): void {
    logger.log('🧹 Force cleanup for room switch');
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
    this.dbLoaded = false;
    this.dbLoadPromise = null;
    this.currentRoomId = null;
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

    const MAX_USERS = 4;

    // Wait for initial awareness sync (500ms should be enough)
    await new Promise(resolve => setTimeout(resolve, 500));

    const currentUsers = this.provider.awareness.getStates().size;
    logger.log(`👥 Current users in room: ${currentUsers}/${MAX_USERS}`);

    if (currentUsers >= MAX_USERS) {
      logger.error('❌ Room is full! Cannot join.');
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
      logger.log('🔄 Merging CRDT states: IndexedDB + Database...');

      // Get IndexedDB state BEFORE loading database
      // This preserves any local offline edits
      const indexedDBLength = this.ydoc.getText('content').length;

      logger.log('📊 IndexedDB state:', indexedDBLength, 'chars');

      // Load from database - this will MERGE with IndexedDB via CRDT
      const loaded = await this.persistence.loadFromDatabase();
      this.dbLoaded = true;

      const finalLength = this.ydoc.getText('content').length;

      if (loaded) {
        logger.log('✅ CRDT merge complete!');
        logger.log('   IndexedDB had:', indexedDBLength, 'chars');
        logger.log('   Merged result:', finalLength, 'chars');

        // If merged result is different, it means we had offline edits
        if (finalLength > indexedDBLength) {
          logger.log('🔀 Database had newer content - merged via CRDT');
        } else if (finalLength < indexedDBLength) {
          logger.log('🔀 IndexedDB had newer content - merged via CRDT');
        } else if (indexedDBLength > 0) {
          logger.log('✓ Both sources had same content');
        }
      } else {
        logger.log('📝 No database content, using IndexedDB state only');
      }

      // Seed new rooms with 14 empty lines
      const xmlFragment = this.ydoc.getXmlFragment('prosemirror');
      if (xmlFragment.length === 0) {
        logger.log('📝 New room detected - initializing with 14 empty lines');
        for (let i = 0; i < 14; i++) {
          xmlFragment.push([new XmlElement('paragraph')]);
        }
      }

      // Enable auto-save after loading
      this.persistence.enableAutoSave();

      // Add save-on-close to prevent data loss
      this.addBeforeUnloadHandler();
    } catch (error) {
      logger.error('❌ Failed to load from database:', error);
      // Continue anyway - IndexedDB might have data
      this.persistence?.enableAutoSave();
    }
  }

  private addBeforeUnloadHandler(): void {
    window.addEventListener('beforeunload', () => {
      logger.log('⚠️ Browser closing - forcing final save and cleanup...');

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

  /**
   * Get the collaborative chat prompt Y.Text
   * This is shared between all users for collaborative prompt editing
   */
  getChatPrompt(): YText | null {
    if (!this.ydoc) return null;
    return this.ydoc.getText('chat-prompt');
  }

  /**
   * Get the chat messages Y.Array
   * This stores the shared message history (ephemeral - not persisted to DB)
   */
  getChatMessages(): YArray<ChatMessage> | null {
    if (!this.ydoc) return null;
    return this.ydoc.getArray<ChatMessage>('chat-messages');
  }

  /**
   * Get the shared chat attachment metadata Y.Array
   * Just metadata - actual files stay in the owner's browser
   */
  getChatAttachmentsMeta(): YArray<SharedAttachmentMeta> | null {
    if (!this.ydoc) return null;
    return this.ydoc.getArray<SharedAttachmentMeta>('chat-attachments-meta');
  }

  /**
   * Get the send request Y.Map
   * When someone presses Enter, this signals the peer with files to make the API call
   */
  getSendRequest(): import('yjs').Map<any> | null {
    if (!this.ydoc) return null;
    return this.ydoc.getMap('chat-send-request');
  }

  /**
   * Get the chat threads Y.Map
   * Stores thread metadata for multi-chat support
   */
  getChatThreads(): import('yjs').Map<any> | null {
    if (!this.ydoc) return null;
    return this.ydoc.getMap('chat-threads');
  }

  /**
   * Get chat messages for a specific thread
   * Each thread has its own Y.Array for independent message history
   */
  getChatThreadMessages(threadId: string): YArray<ChatMessage> | null {
    if (!this.ydoc) return null;
    return this.ydoc.getArray<ChatMessage>(`chat-messages-${threadId}`);
  }

  /**
   * Get the chat prompt for a specific thread
   */
  getChatThreadPrompt(threadId: string): YText | null {
    if (!this.ydoc) return null;
    return this.ydoc.getText(`chat-prompt-${threadId}`);
  }

  /**
   * Get the send request map for a specific thread
   */
  getThreadSendRequest(threadId: string): import('yjs').Map<any> | null {
    if (!this.ydoc) return null;
    return this.ydoc.getMap(`chat-send-request-${threadId}`);
  }

  /**
   * Get current user info (name, color)
   */
  getUserInfo(): { userId: string; color: string; name: string } | null {
    return this.userInfo;
  }

  /**
   * Update the user's color and broadcast to awareness
   */
  setUserColor(color: string): void {
    if (!this.userInfo || !this.provider) return;

    this.userInfo.color = color;
    sessionStorage.setItem('flashy_user_color', color);

    // Broadcast the new color via awareness
    this.provider.awareness.setLocalStateField('user', {
      name: this.userInfo.name,
      color: color,
      colorLight: color + '40',
    });

    // Notify local listeners (for updating local UI)
    this.colorChangeListeners.forEach(listener => listener(color));

    logger.log('🎨 User color updated:', color);
  }

  /**
   * Subscribe to color changes (for local UI updates)
   */
  onColorChange(listener: (color: string) => void): () => void {
    this.colorChangeListeners.add(listener);
    return () => this.colorChangeListeners.delete(listener);
  }

  /**
   * Get colors currently used by other users in the room
   */
  getUsedColors(): string[] {
    if (!this.provider) return [];

    const usedColors: string[] = [];
    const myClientId = this.provider.awareness.doc.clientID;

    this.provider.awareness.getStates().forEach((state: any, clientId: number) => {
      if (clientId !== myClientId && state.user?.color) {
        usedColors.push(state.user.color.toUpperCase());
      }
    });

    return usedColors;
  }

  disconnect(): void {
    this.refCount--;
    logger.log('📊 CollaborationManager.disconnect() - refCount:', this.refCount);

    // Don't destroy immediately - allow for quick remounts
    if (this.refCount <= 0) {
      logger.log('⏳ Scheduling cleanup in 2s (in case of remount)...');

      this.cleanupTimer = setTimeout(() => {
        if (this.refCount <= 0) {
          logger.log('🧹 Cleaning up provider (confirmed no active references)');

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
          logger.log('♻️  Provider still in use, skipping cleanup');
        }
      }, 2000);
    }
  }
}

export const collaborationManager = CollaborationManager.getInstance();
