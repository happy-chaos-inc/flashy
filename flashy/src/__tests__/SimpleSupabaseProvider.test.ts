/**
 * SIMPLE SUPABASE PROVIDER TESTS
 * Tests for the real-time collaboration provider
 * Tests provider behavior and CRDT integration
 */

import * as Y from 'yjs';

// Mock logger at the top level
jest.mock('../lib/logger', () => ({
  logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('SimpleSupabaseProvider', () => {
  let SimpleSupabaseProvider: any;

  beforeAll(async () => {
    const module = await import('../lib/SimpleSupabaseProvider');
    SimpleSupabaseProvider = module.SimpleSupabaseProvider;
  });

  describe('Constructor and Initialization', () => {
    it('should create provider with Y.Doc reference', () => {
      const doc = new Y.Doc();
      const mockSupabase = {
        channel: jest.fn(() => ({
          on: jest.fn().mockReturnThis(),
          subscribe: jest.fn(),
          send: jest.fn(),
          unsubscribe: jest.fn(),
        })),
      };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');

      expect(provider.doc).toBe(doc);
      expect(provider.connected).toBe(false);

      provider.destroy();
      doc.destroy();
    });

    it('should create awareness instance', () => {
      const doc = new Y.Doc();
      const mockSupabase = {
        channel: jest.fn(() => ({
          on: jest.fn().mockReturnThis(),
          subscribe: jest.fn(),
          send: jest.fn(),
          unsubscribe: jest.fn(),
        })),
      };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');

      expect(provider.awareness).toBeDefined();
      expect(typeof provider.awareness.getStates).toBe('function');
      expect(typeof provider.awareness.setLocalStateField).toBe('function');

      provider.destroy();
      doc.destroy();
    });
  });

  describe('Event Emitter Interface', () => {
    it('should implement on() and off() methods', () => {
      const doc = new Y.Doc();
      const mockSupabase = {
        channel: jest.fn(() => ({
          on: jest.fn().mockReturnThis(),
          subscribe: jest.fn(),
          send: jest.fn(),
          unsubscribe: jest.fn(),
        })),
      };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');

      const handler = jest.fn();
      provider.on('status', handler);
      provider.off('status', handler);

      expect(typeof provider.on).toBe('function');
      expect(typeof provider.off).toBe('function');

      provider.destroy();
      doc.destroy();
    });
  });

  describe('Connection', () => {
    it('should create channel with correct config on connect', () => {
      const doc = new Y.Doc();
      const mockChannel = {
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn((cb) => {
          cb('SUBSCRIBED');
          return mockChannel;
        }),
        send: jest.fn(),
        unsubscribe: jest.fn(),
      };
      const mockSupabase = { channel: jest.fn(() => mockChannel) };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');
      provider.connect();

      expect(mockSupabase.channel).toHaveBeenCalledWith('test-channel', {
        config: {
          broadcast: {
            self: false,
            ack: false,
          },
        },
      });

      provider.destroy();
      doc.destroy();
    });

    it('should set connected=true on SUBSCRIBED status', () => {
      const doc = new Y.Doc();
      const mockChannel = {
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn((cb) => {
          cb('SUBSCRIBED');
          return mockChannel;
        }),
        send: jest.fn(),
        unsubscribe: jest.fn(),
      };
      const mockSupabase = { channel: jest.fn(() => mockChannel) };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');
      expect(provider.connected).toBe(false);
      provider.connect();
      expect(provider.connected).toBe(true);

      provider.destroy();
      doc.destroy();
    });

    it('should not reconnect if already connected', () => {
      const doc = new Y.Doc();
      const mockChannel = {
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn((cb) => {
          cb('SUBSCRIBED');
          return mockChannel;
        }),
        send: jest.fn(),
        unsubscribe: jest.fn(),
      };
      const mockSupabase = { channel: jest.fn(() => mockChannel) };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');
      provider.connect();
      mockSupabase.channel.mockClear();
      provider.connect();

      expect(mockSupabase.channel).not.toHaveBeenCalled();

      provider.destroy();
      doc.destroy();
    });

    it('should emit status event on successful connection', () => {
      const doc = new Y.Doc();
      const mockChannel = {
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn((cb) => {
          cb('SUBSCRIBED');
          return mockChannel;
        }),
        send: jest.fn(),
        unsubscribe: jest.fn(),
      };
      const mockSupabase = { channel: jest.fn(() => mockChannel) };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');
      const statusHandler = jest.fn();
      provider.on('status', statusHandler);
      provider.connect();

      expect(statusHandler).toHaveBeenCalledWith({ status: 'connected' });

      provider.destroy();
      doc.destroy();
    });

    it('should handle CHANNEL_ERROR status', () => {
      const doc = new Y.Doc();
      const mockChannel = {
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn((cb) => {
          cb('CHANNEL_ERROR');
          return mockChannel;
        }),
        send: jest.fn(),
        unsubscribe: jest.fn(),
      };
      const mockSupabase = { channel: jest.fn(() => mockChannel) };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');
      const statusHandler = jest.fn();
      provider.on('status', statusHandler);
      provider.connect();

      expect(provider.connected).toBe(false);
      expect(statusHandler).toHaveBeenCalledWith({ status: 'disconnected' });

      provider.destroy();
      doc.destroy();
    });

    it('should handle TIMED_OUT status', () => {
      const doc = new Y.Doc();
      const mockChannel = {
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn((cb) => {
          cb('TIMED_OUT');
          return mockChannel;
        }),
        send: jest.fn(),
        unsubscribe: jest.fn(),
      };
      const mockSupabase = { channel: jest.fn(() => mockChannel) };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');
      const statusHandler = jest.fn();
      provider.on('status', statusHandler);
      provider.connect();

      expect(provider.connected).toBe(false);
      expect(statusHandler).toHaveBeenCalledWith({ status: 'disconnected' });

      provider.destroy();
      doc.destroy();
    });
  });

  describe('Sync Protocol', () => {
    it('should send sync-request after connection', () => {
      const doc = new Y.Doc();
      const mockChannel = {
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn((cb) => {
          cb('SUBSCRIBED');
          return mockChannel;
        }),
        send: jest.fn(),
        unsubscribe: jest.fn(),
      };
      const mockSupabase = { channel: jest.fn(() => mockChannel) };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');
      provider.connect();

      expect(mockChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'sync-request',
        payload: { clientId: doc.clientID },
      });

      provider.destroy();
      doc.destroy();
    });

    it('should listen for required broadcast events', () => {
      const doc = new Y.Doc();
      const mockChannel = {
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn((cb) => {
          cb('SUBSCRIBED');
          return mockChannel;
        }),
        send: jest.fn(),
        unsubscribe: jest.fn(),
      };
      const mockSupabase = { channel: jest.fn(() => mockChannel) };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');
      provider.connect();

      const onCalls = mockChannel.on.mock.calls;
      const events = onCalls.map(call => call[1]?.event);

      expect(events).toContain('doc-update');
      expect(events).toContain('sync-request');
      expect(events).toContain('sync-response');
      expect(events).toContain('awareness');

      provider.destroy();
      doc.destroy();
    });
  });

  describe('Disconnection', () => {
    it('should unsubscribe channel on disconnect', () => {
      const doc = new Y.Doc();
      const mockChannel = {
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn((cb) => {
          cb('SUBSCRIBED');
          return mockChannel;
        }),
        send: jest.fn(),
        unsubscribe: jest.fn(),
      };
      const mockSupabase = { channel: jest.fn(() => mockChannel) };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');
      provider.connect();
      provider.disconnect();

      expect(mockChannel.unsubscribe).toHaveBeenCalled();

      provider.destroy();
      doc.destroy();
    });

    it('should set connected=false on disconnect', () => {
      const doc = new Y.Doc();
      const mockChannel = {
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn((cb) => {
          cb('SUBSCRIBED');
          return mockChannel;
        }),
        send: jest.fn(),
        unsubscribe: jest.fn(),
      };
      const mockSupabase = { channel: jest.fn(() => mockChannel) };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');
      provider.connect();
      expect(provider.connected).toBe(true);
      provider.disconnect();
      expect(provider.connected).toBe(false);

      provider.destroy();
      doc.destroy();
    });

    it('should emit status disconnected on disconnect', () => {
      const doc = new Y.Doc();
      const mockChannel = {
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn((cb) => {
          cb('SUBSCRIBED');
          return mockChannel;
        }),
        send: jest.fn(),
        unsubscribe: jest.fn(),
      };
      const mockSupabase = { channel: jest.fn(() => mockChannel) };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');
      const statusHandler = jest.fn();
      provider.on('status', statusHandler);
      provider.connect();
      statusHandler.mockClear();
      provider.disconnect();

      expect(statusHandler).toHaveBeenCalledWith({ status: 'disconnected' });

      provider.destroy();
      doc.destroy();
    });
  });

  describe('Destroy', () => {
    it('should disconnect and destroy awareness on destroy', () => {
      const doc = new Y.Doc();
      const mockChannel = {
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn((cb) => {
          cb('SUBSCRIBED');
          return mockChannel;
        }),
        send: jest.fn(),
        unsubscribe: jest.fn(),
      };
      const mockSupabase = { channel: jest.fn(() => mockChannel) };

      const provider = new SimpleSupabaseProvider(doc, mockSupabase as any, 'test-channel');
      provider.connect();
      provider.destroy();

      expect(provider.connected).toBe(false);

      doc.destroy();
    });
  });
});

describe('CRDT Integration (Y.js)', () => {
  it('should maintain eventual consistency with multiple docs', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    const doc3 = new Y.Doc();

    doc1.getText('content').insert(0, 'User 1 ');
    doc2.getText('content').insert(0, 'User 2 ');
    doc3.getText('content').insert(0, 'User 3 ');

    const update1 = Y.encodeStateAsUpdate(doc1);
    const update2 = Y.encodeStateAsUpdate(doc2);
    const update3 = Y.encodeStateAsUpdate(doc3);

    const docA = new Y.Doc();
    Y.applyUpdate(docA, update1);
    Y.applyUpdate(docA, update2);
    Y.applyUpdate(docA, update3);

    const docB = new Y.Doc();
    Y.applyUpdate(docB, update3);
    Y.applyUpdate(docB, update1);
    Y.applyUpdate(docB, update2);

    expect(docA.getText('content').toString()).toBe(
      docB.getText('content').toString()
    );

    [doc1, doc2, doc3, docA, docB].forEach(d => d.destroy());
  });

  it('should handle update order independence', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    doc1.getText('content').insert(0, 'First ');
    doc2.getText('content').insert(0, 'Second ');

    const update1 = Y.encodeStateAsUpdate(doc1);
    const update2 = Y.encodeStateAsUpdate(doc2);

    const resultA = new Y.Doc();
    Y.applyUpdate(resultA, update1);
    Y.applyUpdate(resultA, update2);

    const resultB = new Y.Doc();
    Y.applyUpdate(resultB, update2);
    Y.applyUpdate(resultB, update1);

    expect(resultA.getText('content').toString()).toBe(
      resultB.getText('content').toString()
    );

    [doc1, doc2, resultA, resultB].forEach(d => d.destroy());
  });

  it('should handle idempotent updates', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    doc2.getText('content').insert(0, 'Test');
    const update = Y.encodeStateAsUpdate(doc2);

    Y.applyUpdate(doc1, update);
    Y.applyUpdate(doc1, update);
    Y.applyUpdate(doc1, update);

    expect(doc1.getText('content').toString()).toBe('Test');

    doc1.destroy();
    doc2.destroy();
  });

  it('should preserve unicode characters', () => {
    const doc = new Y.Doc();
    const unicode = '🎉 Hello 世界 emoji and unicode! 🚀';
    doc.getText('content').insert(0, unicode);

    const state = Y.encodeStateAsUpdate(doc);
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, state);

    expect(doc2.getText('content').toString()).toBe(unicode);

    doc.destroy();
    doc2.destroy();
  });
});
