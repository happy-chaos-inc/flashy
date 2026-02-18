/**
 * Simple Supabase Provider for Yjs
 * With auto-reconnection and offline queue support
 */
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

// Reconnection settings
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const MAX_RECONNECT_ATTEMPTS = 10;

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

  // Offline queue - store updates when disconnected
  private pendingUpdates: Uint8Array[] = [];
  private maxPendingUpdates: number = 100;

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

    // Cleanup old channel if exists
    if (this.channel) {
      logger.log('SimpleProvider: Cleaning up old channel...');
      try {
        this.channel.unsubscribe();
      } catch {
        // Ignore cleanup errors
      }
      this.channel = null;
    }

    // Create fresh channel
    this.channel = this.supabase.channel(this.channelName, {
      config: {
        broadcast: {
          self: true,
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
          this.reconnectAttempts = 0; // Reset on successful connection
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

        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          logger.error('SimpleProvider:', status);
          this.connected = false;
          this.emit('status', { status: 'disconnected' });

          // Auto-reconnect
          this.scheduleReconnect();

        } else if (status === 'CLOSED') {
          this.connected = false;
          this.emit('status', { status: 'disconnected' });

          // Auto-reconnect if not intentionally destroyed
          if (!this.isDestroyed) {
            this.scheduleReconnect();
          }
        }
      } catch (error) {
        logger.error('SimpleProvider: Error in subscription handler', error);
        this.connected = false;
        this.emit('status', { status: 'disconnected' });
        this.scheduleReconnect();
      }
    });
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

    // Broadcast local document changes
    this.doc.on('update', (update: Uint8Array, origin: any) => {
      // Don't broadcast updates that came from remote
      if (origin === this) return;

      if (!this.connected) {
        // Queue for later if disconnected
        if (this.pendingUpdates.length < this.maxPendingUpdates) {
          this.pendingUpdates.push(update);
          logger.log('SimpleProvider: Queued update (disconnected)');
        } else {
          logger.warn('SimpleProvider: Pending queue full, dropping update');
        }
        return;
      }

      try {
        this.channel.send({
          type: 'broadcast',
          event: 'doc-update',
          payload: { update: Array.from(update) }
        });
      } catch (error) {
        // Queue on send failure
        if (this.pendingUpdates.length < this.maxPendingUpdates) {
          this.pendingUpdates.push(update);
        }
        logger.error('SimpleProvider: Failed to broadcast, queued', error);
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
