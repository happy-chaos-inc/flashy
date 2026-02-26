import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { IndexeddbPersistence } from 'y-indexeddb';

type EventCallback = (...args: any[]) => void;

export class SupabaseProvider {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  channel: RealtimeChannel;
  persistence: IndexeddbPersistence | null = null;
  synced: boolean = false;
  connected: boolean = false;
  private eventListeners: Map<string, Set<EventCallback>> = new Map();
  private connectCheckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(doc: Y.Doc, supabaseClient: SupabaseClient<any>, channelName: string, docName: string = 'default') {
    this.doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);

    // Create channel with explicit broadcast configuration
    console.log('📺 Creating Supabase Realtime channel:', channelName);
    this.channel = supabaseClient.channel(channelName, {
      config: {
        broadcast: {
          self: true, // Receive your own broadcasts
          ack: false, // Don't wait for acknowledgments (faster)
        },
      },
    });
    console.log('✅ Channel created:', this.channel);

    // Set up IndexedDB persistence for offline support
    this.persistence = new IndexeddbPersistence(docName, doc);
    this.persistence.on('synced', () => {
      console.log('📦 Local persistence loaded');
    });

    // Listen to Yjs doc updates and broadcast via Supabase
    this.doc.on('update', this.handleDocUpdate);

    // Listen to awareness changes (cursor positions, user presence)
    this.awareness.on('update', this.handleAwarenessUpdate);
  }

  handleDocUpdate = (update: Uint8Array, origin: any) => {
    // Don't broadcast updates we received from network (prevent echo)
    if (origin !== this && this.connected) {
      console.log('📤 Broadcasting local update:', update.length, 'bytes');
      // Convert Uint8Array to regular array for JSON serialization
      this.channel.send({
        type: 'broadcast',
        event: 'yjs-update',
        payload: { update: Array.from(update) }
      });
    }
  };

  handleRemoteUpdate = ({ payload }: any) => {
    console.log('📥 Received remote update:', payload.update.length, 'bytes');
    // Convert array back to Uint8Array and apply to doc
    const update = new Uint8Array(payload.update);
    Y.applyUpdate(this.doc, update, this);

    // Emit sync event on first successful update
    if (!this.synced) {
      this.synced = true;
      this.emit('sync', true);
      console.log('✅ First sync complete');
    }
  };

  handleAwarenessUpdate = ({ added, updated, removed }: any) => {
    if (!this.connected) {
      console.log('⏸️  Skipping awareness update - not connected yet');
      return;
    }

    const changedClients = added.concat(updated).concat(removed);
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
      this.awareness,
      changedClients
    );

    this.channel.send({
      type: 'broadcast',
      event: 'yjs-awareness',
      payload: { awareness: Array.from(awarenessUpdate) }
    });
  };

  handleRemoteAwareness = ({ payload }: any) => {
    const awarenessUpdate = new Uint8Array(payload.awareness);
    awarenessProtocol.applyAwarenessUpdate(
      this.awareness,
      awarenessUpdate,
      this
    );
  };

  handleSyncRequest = () => {
    // Another client is requesting full state - send them our current state
    console.log('📨 Received sync request, sending full state');
    const stateVector = Y.encodeStateAsUpdate(this.doc);
    this.channel.send({
      type: 'broadcast',
      event: 'sync-response',
      payload: { state: Array.from(stateVector) }
    });
  };

  handleSyncResponse = ({ payload }: any) => {
    // Received full state from another client
    console.log('📥 Received sync response, applying state');
    const state = new Uint8Array(payload.state);
    Y.applyUpdate(this.doc, state, this);

    if (!this.synced) {
      this.synced = true;
      this.emit('sync', true);
    }
  };

  connect(): void {
    // Check if channel is closed and recreate if needed
    const channelState = (this.channel as any).state;
    if (channelState === 'closed') {
      console.log('⚠️  Channel is closed, creating new channel...');
      const oldTopic = this.channel.topic;
      this.channel.unsubscribe();

      // Extract channel name from topic (format: "realtime:channelName")
      const channelName = oldTopic.replace('realtime:', '');
      this.channel = (this.channel as any).socket.channel(channelName, {
        config: {
          broadcast: { self: true, ack: false },
        },
      });
    }

    console.log('🔌 Connecting to Supabase channel...');
    console.log('🔍 Channel config:', this.channel);

    // Set up broadcast listeners
    this.channel
      .on('broadcast', { event: 'yjs-update' }, this.handleRemoteUpdate)
      .on('broadcast', { event: 'yjs-awareness' }, this.handleRemoteAwareness)
      .on('broadcast', { event: 'sync-request' }, this.handleSyncRequest)
      .on('broadcast', { event: 'sync-response' }, this.handleSyncResponse)
      .subscribe(async (status) => {
        console.log('📡 Channel subscription status:', status);
        this.emit('status', { status });

        if (status === 'SUBSCRIBED') {
          this.connected = true;
          console.log('✅ Yjs CRDT sync ready');
          this.emit('status', { status: 'connected' });

          // Request full state from other connected clients
          console.log('🔄 Requesting initial state from peers');
          this.channel.send({
            type: 'broadcast',
            event: 'sync-request',
            payload: {}
          });

          // Announce our presence to other clients
          const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
            this.awareness,
            [this.doc.clientID]
          );
          this.channel.send({
            type: 'broadcast',
            event: 'yjs-awareness',
            payload: { awareness: Array.from(awarenessUpdate) }
          });
        } else if (status === 'CHANNEL_ERROR') {
          this.connected = false;
          console.error('❌ Connection error');
          this.emit('status', { status: 'disconnected' });
        }
      });

    // WORKAROUND: Check if already connected (callback might not fire)
    this.connectCheckTimer = setTimeout(() => {
      const state = (this.channel as any).state;
      console.log('🔍 Checking channel state after subscribe:', state);

      if (state === 'joined' && !this.connected) {
        console.log('⚠️  Channel joined but callback not fired, manually setting connected');
        this.connected = true;
        this.emit('status', { status: 'connected' });

        // Send initial sync request
        this.channel.send({
          type: 'broadcast',
          event: 'sync-request',
          payload: {}
        });

        // Announce presence
        const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          [this.doc.clientID]
        );
        this.channel.send({
          type: 'broadcast',
          event: 'yjs-awareness',
          payload: { awareness: Array.from(awarenessUpdate) }
        });
      }
    }, 100);
  }

  disconnect(): void {
    this.connected = false;

    // Clean up awareness state before disconnecting
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.doc.clientID],
      'disconnect'
    );

    this.channel.unsubscribe();
    this.emit('status', { status: 'disconnected' });
  }

  destroy(): void {
    if (this.connectCheckTimer) {
      clearTimeout(this.connectCheckTimer);
      this.connectCheckTimer = null;
    }

    this.doc.off('update', this.handleDocUpdate);
    this.awareness.off('update', this.handleAwarenessUpdate);

    if (this.persistence) {
      this.persistence.destroy();
    }

    this.disconnect();
    this.awareness.destroy();
  }

  // Event emitter methods required by Provider interface
  on(type: string, cb: EventCallback): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(cb);
  }

  off(type: string, cb: EventCallback): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(cb);
    }
  }

  private emit(type: string, ...args: any[]): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach((cb) => cb(...args));
    }
  }
}
