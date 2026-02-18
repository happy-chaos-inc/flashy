/**
 * Simple Supabase Provider for Yjs
 * Minimal implementation - no workarounds, just the basics
 */
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

export class SimpleSupabaseProvider {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  private supabase: SupabaseClient<any>;
  private channelName: string;
  private channel: any;
  connected: boolean = false;
  private broadcastingSetup: boolean = false;
  private eventHandlers: Map<string, Set<Function>> = new Map();

  constructor(doc: Y.Doc, supabase: SupabaseClient<any>, channelName: string) {
    this.doc = doc;
    this.supabase = supabase;
    this.channelName = channelName;
    this.awareness = new awarenessProtocol.Awareness(doc);

    logger.log('📺 SimpleProvider: Creating channel:', channelName);
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
    // Don't reconnect if already connected
    if (this.connected && this.channel) {
      logger.log('✅ SimpleProvider: Already connected, skipping');
      return;
    }

    logger.log('🔌 SimpleProvider: Connecting...');

    // Cleanup old channel if exists
    if (this.channel) {
      logger.log('🧹 Cleaning up old channel...');
      this.channel.unsubscribe();
      this.channel = null;
    }

    // Create fresh channel
    this.channel = this.supabase.channel(this.channelName, {
      config: {
        broadcast: {
          self: true, // Receive our own messages for debugging
          ack: false, // Don't wait for acknowledgments
        },
      },
    });

    // Listen for document updates from other clients
    this.channel.on('broadcast', { event: 'doc-update' }, ({ payload }: any) => {
      try {
        logger.log('📥 SimpleProvider: Received doc update', payload.update.length, 'bytes');
        const update = new Uint8Array(payload.update);
        Y.applyUpdate(this.doc, update, this);
        logger.log('✅ Applied update to local doc');
      } catch (error) {
        logger.error('❌ SimpleProvider: Failed to apply doc update', error);
      }
    });

    // Listen for sync requests from new clients
    this.channel.on('broadcast', { event: 'sync-request' }, ({ payload }: any) => {
      try {
        // Don't respond to our own sync request
        if (payload.clientId === this.doc.clientID) return;

        logger.log('📥 SimpleProvider: Received sync request from', payload.clientId);
        // Send our full state to the requesting client
        const state = Y.encodeStateAsUpdate(this.doc);
        logger.log('📤 SimpleProvider: Sending full state', state.length, 'bytes');
        this.channel.send({
          type: 'broadcast',
          event: 'sync-response',
          payload: {
            update: Array.from(state),
            targetClientId: payload.clientId
          }
        });
      } catch (error) {
        logger.error('❌ SimpleProvider: Failed to handle sync request', error);
      }
    });

    // Listen for sync responses
    this.channel.on('broadcast', { event: 'sync-response' }, ({ payload }: any) => {
      try {
        // Only apply if this response is for us
        if (payload.targetClientId !== this.doc.clientID) return;

        logger.log('📥 SimpleProvider: Received sync response', payload.update.length, 'bytes');
        const update = new Uint8Array(payload.update);
        Y.applyUpdate(this.doc, update, this);
        logger.log('✅ Applied full state sync');
      } catch (error) {
        logger.error('❌ SimpleProvider: Failed to apply sync response', error);
      }
    });

    // Listen for awareness updates (cursors, presence)
    this.channel.on('broadcast', { event: 'awareness' }, ({ payload }: any) => {
      try {
        logger.log('📥 SimpleProvider: Received awareness update');
        const update = new Uint8Array(payload.update);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this);
      } catch (error) {
        logger.error('❌ SimpleProvider: Failed to apply awareness update', error);
      }
    });

    // Subscribe to channel
    this.channel.subscribe((status: string) => {
      try {
        logger.log('📡 SimpleProvider: Status:', status);

        if (status === 'SUBSCRIBED') {
          this.connected = true;
          logger.log('✅ SimpleProvider: Connected!');

          // Emit status event for compatibility
          this.emit('status', { status: 'connected' });

          // Set up local update broadcasting
          this.setupLocalBroadcasting();

          // Request sync from other clients to get their state
          logger.log('📤 SimpleProvider: Requesting sync from other clients');
          this.channel.send({
            type: 'broadcast',
            event: 'sync-request',
            payload: { clientId: this.doc.clientID }
          });
        } else if (status === 'CHANNEL_ERROR') {
          logger.error('❌ SimpleProvider: Channel error');
          this.connected = false;
          this.emit('status', { status: 'disconnected' });
        } else if (status === 'TIMED_OUT') {
          logger.error('❌ SimpleProvider: Timeout');
          this.connected = false;
          this.emit('status', { status: 'disconnected' });
        }
      } catch (error) {
        logger.error('❌ SimpleProvider: Error in subscription handler', error);
        this.connected = false;
        this.emit('status', { status: 'disconnected' });
      }
    });
  }

  private setupLocalBroadcasting(): void {
    // Only set up once
    if (this.broadcastingSetup) {
      logger.log('⏭️  Broadcasting already set up, skipping');
      return;
    }

    logger.log('📡 Setting up local broadcasting...');
    this.broadcastingSetup = true;

    // Broadcast local document changes
    this.doc.on('update', (update: Uint8Array, origin: any) => {
      logger.log('📝 SimpleProvider: Doc update detected!');
      logger.log('   Origin:', origin?.constructor?.name || origin);
      logger.log('   Origin === this?', origin === this);
      logger.log('   Connected?', this.connected);
      logger.log('   Update size:', update.length, 'bytes');

      // Don't broadcast updates that came from remote (would create loop)
      // But DO broadcast updates from local editing (CodeMirror/yCollab)
      if (origin === this) {
        logger.log('⏸️  Skipping broadcast - origin is this provider (came from remote)');
        return;
      }

      if (!this.connected) {
        logger.log('⏸️  Skipping broadcast - not connected');
        return;
      }

      logger.log('📤 SimpleProvider: Broadcasting doc update:', update.length, 'bytes');
      const result = this.channel.send({
        type: 'broadcast',
        event: 'doc-update',
        payload: { update: Array.from(update) }
      });
      logger.log('📤 Broadcast result:', result);
    });

    // Broadcast local awareness changes
    this.awareness.on('update', ({ added, updated, removed }: any) => {
      if (!this.connected) return;

      const changedClients = added.concat(updated).concat(removed);
      const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);

      logger.log('📤 SimpleProvider: Broadcasting awareness');
      this.channel.send({
        type: 'broadcast',
        event: 'awareness',
        payload: { update: Array.from(update) }
      });
    });
  }

  disconnect(): void {
    logger.log('🔌 SimpleProvider: Disconnecting...');
    if (this.channel) {
      this.channel.unsubscribe();
    }
    this.connected = false;
    this.emit('status', { status: 'disconnected' });
  }

  destroy(): void {
    logger.log('🗑️  SimpleProvider: Destroying...');
    this.disconnect();
    this.awareness.destroy();
  }
}
