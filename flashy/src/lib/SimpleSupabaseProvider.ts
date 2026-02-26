/**
 * Simple Supabase Provider for Yjs
 * With auto-reconnection, offline queue, and dual resync strategy:
 * 1. Visibility-based: immediate resync on tab refocus (catches "user was away")
 * 2. Periodic safety net: 30s state-vector exchange (catches silently dropped broadcasts)
 *
 * Supabase Realtime broadcast is fire-and-forget (ack: false). For 4 concurrent
 * users actively editing, we need both strategies to match Google Docs / Notion
 * sync quality. The periodic resync is lightweight (~50-100 bytes per state vector)
 * and only triggers a full sync-response when there's actually a diff.
 */
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

// Reconnection settings
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const MAX_RECONNECT_ATTEMPTS = 10;

// Safety-net periodic resync — catches silently dropped broadcasts.
// 30s is 3× less frequent than the old 10s timer but still catches gaps
// within a reasonable window. For 4 users: 8 state-vector msgs/min (tiny).
const PERIODIC_RESYNC_INTERVAL = 30_000; // 30 seconds

export class SimpleSupabaseProvider {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  private supabase: SupabaseClient<any>;
  private channelName: string;
  private channel: any;
  connected: boolean = false;
  private broadcastingSetup: boolean = false;
  private eventHandlers: Map<string, Set<Function>> = new Map();

  // Reconnection state
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isDestroyed: boolean = false;
  private lastConnectedAt: number = 0;

  // Offline queue - store updates when disconnected
  private pendingUpdates: Uint8Array[] = [];
  private maxPendingUpdates: number = 100;

  // Update batching — accumulate rapid updates and send as one
  private updateBatch: Uint8Array[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_INTERVAL = 50; // ms — batch updates within 50ms

  // Dual resync: visibility-based + periodic safety net
  private visibilityHandler: (() => void) | null = null;
  private resyncTimer: NodeJS.Timeout | null = null;

  constructor(doc: Y.Doc, supabase: SupabaseClient<any>, channelName: string) {
    this.doc = doc;
    this.supabase = supabase;
    this.channelName = channelName;
    this.awareness = new awarenessProtocol.Awareness(doc);

    logger.log('SimpleProvider: Creating channel:', channelName);
  }

  // Implement Provider interface methods for compatibility with createBinding
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

  connect(): void {
    // Don't reconnect if already connected or destroyed
    if (this.isDestroyed) {
      logger.log('SimpleProvider: Destroyed, not connecting');
      return;
    }

    if (this.connected && this.channel) {
      logger.log('SimpleProvider: Already connected, skipping');
      return;
    }

    logger.log('SimpleProvider: Connecting...');

    // Cleanup old channel if exists — must fully remove before creating a new one
    if (this.channel) {
      logger.log('SimpleProvider: Cleaning up old channel...');
      try {
        this.supabase.removeChannel(this.channel);
      } catch {
        // Ignore cleanup errors
      }
      this.channel = null;
    }

    // Create fresh channel
    this.channel = this.supabase.channel(this.channelName, {
      config: {
        broadcast: {
          self: false, // Don't receive our own broadcasts — wastes CPU and triggers redundant saves
          ack: false,
        },
      },
    });

    // Listen for document updates from other clients
    this.channel.on('broadcast', { event: 'doc-update' }, ({ payload }: any) => {
      try {
        logger.log('SimpleProvider: Received doc update', payload.update.length, 'bytes');
        const update = new Uint8Array(payload.update);
        Y.applyUpdate(this.doc, update, this);
      } catch (error) {
        logger.error('SimpleProvider: Failed to apply doc update', error);
      }
    });

    // Listen for sync requests from new clients
    this.channel.on('broadcast', { event: 'sync-request' }, ({ payload }: any) => {
      try {
        if (payload.clientId === this.doc.clientID) return;

        logger.log('SimpleProvider: Received sync request from', payload.clientId);
        const state = Y.encodeStateAsUpdate(this.doc);
        this.channel.send({
          type: 'broadcast',
          event: 'sync-response',
          payload: {
            update: Array.from(state),
            targetClientId: payload.clientId
          }
        });
      } catch (error) {
        logger.error('SimpleProvider: Failed to handle sync request', error);
      }
    });

    // Listen for sync responses
    this.channel.on('broadcast', { event: 'sync-response' }, ({ payload }: any) => {
      try {
        if (payload.targetClientId !== this.doc.clientID) return;

        logger.log('SimpleProvider: Received sync response', payload.update.length, 'bytes');
        const update = new Uint8Array(payload.update);
        Y.applyUpdate(this.doc, update, this);
      } catch (error) {
        logger.error('SimpleProvider: Failed to apply sync response', error);
      }
    });

    // Listen for state vector broadcasts (resync on reconnect/focus)
    this.channel.on('broadcast', { event: 'state-vector' }, ({ payload }: any) => {
      try {
        if (payload.clientId === this.doc.clientID) return;

        // Compute what the remote peer is missing and send it
        const remoteStateVector = new Uint8Array(payload.sv);
        const missingUpdate = Y.encodeStateAsUpdate(this.doc, remoteStateVector);

        // Only send if there's actually something missing (> 2 bytes = non-empty update)
        if (missingUpdate.length > 2) {
          logger.log('SimpleProvider: Peer missing', missingUpdate.length, 'bytes, sending catch-up');
          this.channel.send({
            type: 'broadcast',
            event: 'sync-response',
            payload: {
              update: Array.from(missingUpdate),
              targetClientId: payload.clientId
            }
          });
        }
      } catch (error) {
        logger.error('SimpleProvider: Failed to handle state-vector', error);
      }
    });

    // Listen for awareness updates (cursors, presence)
    this.channel.on('broadcast', { event: 'awareness' }, ({ payload }: any) => {
      try {
        const update = new Uint8Array(payload.update);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this);
      } catch (error) {
        logger.error('SimpleProvider: Failed to apply awareness update', error);
      }
    });

    // Subscribe to channel
    this.channel.subscribe((status: string) => {
      try {
        logger.log('SimpleProvider: Status:', status);

        if (status === 'SUBSCRIBED') {
          this.connected = true;
          this.lastConnectedAt = Date.now();
          // Only reset attempts if we stayed connected for at least 30s (avoid rapid cycles)
          if (this.reconnectAttempts > 0) {
            setTimeout(() => {
              if (this.connected) this.reconnectAttempts = 0;
            }, 30_000);
          } else {
            this.reconnectAttempts = 0;
          }
          logger.log('SimpleProvider: Connected!');

          this.emit('status', { status: 'connected' });
          this.setupLocalBroadcasting();

          // Request sync from other clients
          this.channel.send({
            type: 'broadcast',
            event: 'sync-request',
            payload: { clientId: this.doc.clientID }
          });

          // Flush any pending updates
          this.flushPendingUpdates();

          // Start dual resync: visibility + periodic safety net
          this.startVisibilityResync();
          this.startPeriodicResync();

        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Log with diagnostic info on first occurrence
          if (this.reconnectAttempts === 0) {
            logger.warn('SimpleProvider:', status, '— channel:', this.channelName,
              'attempt:', this.reconnectAttempts + 1,
              '(falling back to database sync)');
          }
          this.connected = false;
          this.emit('status', { status: 'disconnected' });
          this.stopVisibilityResync();
          this.stopPeriodicResync();

          // Auto-reconnect
          this.scheduleReconnect();

        } else if (status === 'CLOSED') {
          this.connected = false;
          this.emit('status', { status: 'disconnected' });
          this.stopVisibilityResync();
          this.stopPeriodicResync();

          // Auto-reconnect if not intentionally destroyed
          if (!this.isDestroyed) {
            this.scheduleReconnect();
          }
        }
      } catch (error) {
        logger.error('SimpleProvider: Error in subscription handler', error);
        this.connected = false;
        this.emit('status', { status: 'disconnected' });
        this.stopVisibilityResync();
        this.stopPeriodicResync();
        this.scheduleReconnect();
      }
    });
  }

  /**
   * State-vector resync on visibility change (tab refocus).
   * Replaces the 10s polling timer. When a user switches back to this tab,
   * we broadcast our state vector so peers can send anything we missed.
   * This is the Notion-style approach: resync on reconnect, not on a timer.
   */
  private sendStateVector(): void {
    if (!this.connected || this.isDestroyed || !this.channel) return;

    try {
      const sv = Y.encodeStateVector(this.doc);
      this.channel.send({
        type: 'broadcast',
        event: 'state-vector',
        payload: {
          sv: Array.from(sv),
          clientId: this.doc.clientID,
        }
      });
      logger.log('SimpleProvider: State vector sent (visibility resync)');
    } catch {
      // Non-critical
    }
  }

  private startVisibilityResync(): void {
    this.stopVisibilityResync();

    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.connected && !this.isDestroyed) {
        logger.log('SimpleProvider: Tab became visible — resyncing');
        this.sendStateVector();
      }
    };

    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private stopVisibilityResync(): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  /**
   * Periodic safety net: broadcast state vector every 30s.
   * Catches silently dropped broadcasts during active editing sessions
   * where all users stay on the same tab. Each state vector is ~50-100 bytes;
   * peers only respond if there's actually a diff. For 4 users this is
   * 8 tiny messages/minute — negligible load on Supabase.
   */
  private startPeriodicResync(): void {
    this.stopPeriodicResync();
    this.resyncTimer = setInterval(() => {
      if (!this.connected || this.isDestroyed) return;
      this.sendStateVector();
    }, PERIODIC_RESYNC_INTERVAL);
  }

  private stopPeriodicResync(): void {
    if (this.resyncTimer) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;
    if (this.reconnectTimer) return; // Already scheduled
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error('SimpleProvider: Max reconnect attempts reached');
      this.emit('status', { status: 'failed' });
      return;
    }

    // Exponential backoff
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY
    );

    this.reconnectAttempts++;
    logger.log(`SimpleProvider: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isDestroyed) {
        this.connect();
      }
    }, delay);
  }

  private flushPendingUpdates(): void {
    if (this.pendingUpdates.length === 0) return;

    logger.log(`SimpleProvider: Flushing ${this.pendingUpdates.length} pending updates`);

    for (const update of this.pendingUpdates) {
      try {
        this.channel.send({
          type: 'broadcast',
          event: 'doc-update',
          payload: { update: Array.from(update) }
        });
      } catch (error) {
        logger.error('SimpleProvider: Failed to flush update', error);
      }
    }

    this.pendingUpdates = [];
  }

  private setupLocalBroadcasting(): void {
    if (this.broadcastingSetup) return;

    logger.log('SimpleProvider: Setting up local broadcasting...');
    this.broadcastingSetup = true;

    // Broadcast local document changes (batched to stay within rate limits)
    this.doc.on('update', (update: Uint8Array, origin: any) => {
      // Don't broadcast updates that came from remote
      if (origin === this) return;

      if (!this.connected) {
        // Queue for later if disconnected
        if (this.pendingUpdates.length < this.maxPendingUpdates) {
          this.pendingUpdates.push(update);
        } else {
          logger.warn('SimpleProvider: Offline queue full, update dropped. Edits exist in memory — they will sync when connection recovers via state-vector exchange.');
        }
        return;
      }

      // Accumulate updates and flush after a short delay
      this.updateBatch.push(update);

      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => {
          this.batchTimer = null;
          if (this.updateBatch.length === 0) return;

          // Merge all batched updates into one
          const merged = Y.mergeUpdates(this.updateBatch);
          this.updateBatch = [];

          try {
            this.channel.send({
              type: 'broadcast',
              event: 'doc-update',
              payload: { update: Array.from(merged) }
            });
          } catch (error) {
            if (this.pendingUpdates.length < this.maxPendingUpdates) {
              this.pendingUpdates.push(merged);
            }
          }
        }, this.BATCH_INTERVAL);
      }
    });

    // Broadcast local awareness changes
    this.awareness.on('update', ({ added, updated, removed }: any) => {
      if (!this.connected) return;

      try {
        const changedClients = added.concat(updated).concat(removed);
        const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);

        this.channel.send({
          type: 'broadcast',
          event: 'awareness',
          payload: { update: Array.from(update) }
        });
      } catch {
        // Awareness updates are less critical, don't queue
      }
    });
  }

  disconnect(): void {
    logger.log('SimpleProvider: Disconnecting...');

    this.stopVisibilityResync();
    this.stopPeriodicResync();

    // Cancel pending reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.channel) {
      try {
        this.channel.unsubscribe();
      } catch {
        // Ignore
      }
    }

    this.connected = false;
    this.emit('status', { status: 'disconnected' });
  }

  destroy(): void {
    logger.log('SimpleProvider: Destroying...');
    this.isDestroyed = true;
    this.disconnect();
    this.awareness.destroy();
    this.pendingUpdates = [];
  }
}
