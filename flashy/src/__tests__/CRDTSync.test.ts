/**
 * CRDT SYNC TESTS
 * Rigorous tests for Yjs CRDT synchronization edge cases
 * across multi-chat threads, embedding status, and RAG pipeline.
 * These test the logic patterns without requiring actual Yjs instances.
 */
export {};

import * as Y from 'yjs';

// ─── Real Yjs Multi-Thread Isolation ────────────────────────────────

describe('Yjs Multi-Thread Message Isolation', () => {
  let ydoc: Y.Doc;

  beforeEach(() => {
    ydoc = new Y.Doc();
  });

  afterEach(() => {
    ydoc.destroy();
  });

  it('should store messages independently per thread', () => {
    const defaultMessages = ydoc.getArray<any>('chat-messages');
    const thread2Messages = ydoc.getArray<any>('chat-messages-thread-2');

    defaultMessages.push([{ id: 'msg-1', content: 'Hello default' }]);
    thread2Messages.push([{ id: 'msg-2', content: 'Hello thread 2' }]);

    expect(defaultMessages.length).toBe(1);
    expect(thread2Messages.length).toBe(1);
    expect(defaultMessages.get(0).content).toBe('Hello default');
    expect(thread2Messages.get(0).content).toBe('Hello thread 2');
  });

  it('should not cross-contaminate when clearing a thread', () => {
    const defaultMessages = ydoc.getArray<any>('chat-messages');
    const thread2Messages = ydoc.getArray<any>('chat-messages-thread-2');

    defaultMessages.push([{ id: 'msg-1' }, { id: 'msg-2' }]);
    thread2Messages.push([{ id: 'msg-3' }]);

    // Clear thread 2
    thread2Messages.delete(0, thread2Messages.length);

    expect(defaultMessages.length).toBe(2);
    expect(thread2Messages.length).toBe(0);
  });

  it('should handle concurrent pushes to different threads in a transaction', () => {
    const defaultMessages = ydoc.getArray<any>('chat-messages');
    const thread2Messages = ydoc.getArray<any>('chat-messages-thread-2');

    ydoc.transact(() => {
      defaultMessages.push([{ id: 'msg-1', thread: 'default' }]);
      thread2Messages.push([{ id: 'msg-2', thread: 'thread-2' }]);
    });

    expect(defaultMessages.length).toBe(1);
    expect(thread2Messages.length).toBe(1);
  });

  it('should observe changes independently per thread', () => {
    const defaultMessages = ydoc.getArray<any>('chat-messages');
    const thread2Messages = ydoc.getArray<any>('chat-messages-thread-2');

    let defaultChanges = 0;
    let thread2Changes = 0;

    defaultMessages.observe(() => { defaultChanges++; });
    thread2Messages.observe(() => { thread2Changes++; });

    defaultMessages.push([{ id: 'msg-1' }]);
    expect(defaultChanges).toBe(1);
    expect(thread2Changes).toBe(0);

    thread2Messages.push([{ id: 'msg-2' }]);
    expect(defaultChanges).toBe(1);
    expect(thread2Changes).toBe(1);
  });
});

// ─── Yjs Thread Metadata Sync ───────────────────────────────────────

describe('Yjs Thread Metadata Sync', () => {
  let ydoc: Y.Doc;

  beforeEach(() => {
    ydoc = new Y.Doc();
  });

  afterEach(() => {
    ydoc.destroy();
  });

  it('should sync thread creation across peers', () => {
    const threads = ydoc.getMap<any>('chat-threads');

    threads.set('thread-2', { name: 'Research', createdAt: 1000 });

    expect(threads.get('thread-2')?.name).toBe('Research');
    expect(threads.size).toBe(1);
  });

  it('should handle concurrent thread creation from different peers', () => {
    // Simulate two peers creating threads
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const threads1 = doc1.getMap<any>('chat-threads');
    const threads2 = doc2.getMap<any>('chat-threads');

    threads1.set('thread-a', { name: 'From Peer A', createdAt: 1000 });
    threads2.set('thread-b', { name: 'From Peer B', createdAt: 1001 });

    // Sync: apply updates from doc1 to doc2 and vice versa
    const update1 = Y.encodeStateAsUpdate(doc1);
    const update2 = Y.encodeStateAsUpdate(doc2);
    Y.applyUpdate(doc2, update1);
    Y.applyUpdate(doc1, update2);

    // Both docs should have both threads
    expect(threads1.size).toBe(2);
    expect(threads2.size).toBe(2);
    expect(threads1.get('thread-a')?.name).toBe('From Peer A');
    expect(threads1.get('thread-b')?.name).toBe('From Peer B');

    doc1.destroy();
    doc2.destroy();
  });

  it('should handle thread deletion propagation', () => {
    const threads = ydoc.getMap<any>('chat-threads');

    threads.set('thread-2', { name: 'To Delete', createdAt: 1000 });
    threads.set('thread-3', { name: 'To Keep', createdAt: 2000 });

    expect(threads.size).toBe(2);

    threads.delete('thread-2');
    expect(threads.size).toBe(1);
    expect(threads.has('thread-2')).toBe(false);
    expect(threads.get('thread-3')?.name).toBe('To Keep');
  });

  it('should observe thread changes', () => {
    const threads = ydoc.getMap<any>('chat-threads');
    const events: string[] = [];

    threads.observe((event) => {
      event.keysChanged.forEach((key) => {
        events.push(key);
      });
    });

    threads.set('thread-2', { name: 'New Thread' });
    expect(events).toContain('thread-2');
  });
});

// ─── Yjs Embedding Status Propagation ───────────────────────────────

describe('Yjs Embedding Status Propagation', () => {
  let ydoc: Y.Doc;

  beforeEach(() => {
    ydoc = new Y.Doc();
  });

  afterEach(() => {
    ydoc.destroy();
  });

  it('should propagate embeddingStatus updates through Y.Array', () => {
    const meta = ydoc.getArray<any>('chat-attachments-meta');

    meta.push([{ id: 'f1', name: 'doc.pdf', embeddingStatus: 'pending', ownerId: 1 }]);
    expect(meta.get(0).embeddingStatus).toBe('pending');

    // Update status (delete + reinsert pattern used in ChatSidebar)
    const current = meta.get(0);
    meta.delete(0, 1);
    meta.insert(0, [{ ...current, embeddingStatus: 'processing' }]);
    expect(meta.get(0).embeddingStatus).toBe('processing');

    // Complete
    const current2 = meta.get(0);
    meta.delete(0, 1);
    meta.insert(0, [{ ...current2, embeddingStatus: 'ready' }]);
    expect(meta.get(0).embeddingStatus).toBe('ready');
  });

  it('should sync embeddingStatus across two docs', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const meta1 = doc1.getArray<any>('chat-attachments-meta');
    const meta2 = doc2.getArray<any>('chat-attachments-meta');

    // Peer 1 adds file
    meta1.push([{ id: 'f1', name: 'doc.pdf', embeddingStatus: 'pending', ownerId: 1 }]);

    // Sync to peer 2
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    expect(meta2.length).toBe(1);
    expect(meta2.get(0).embeddingStatus).toBe('pending');

    // Peer 1 updates to processing
    const item = meta1.get(0);
    meta1.delete(0, 1);
    meta1.insert(0, [{ ...item, embeddingStatus: 'ready' }]);

    // Sync again
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    expect(meta2.get(0).embeddingStatus).toBe('ready');

    doc1.destroy();
    doc2.destroy();
  });

  it('should handle concurrent embedding and attachment removal', () => {
    const meta = ydoc.getArray<any>('chat-attachments-meta');

    meta.push([
      { id: 'f1', name: 'doc.pdf', embeddingStatus: 'processing', ownerId: 1 },
      { id: 'f2', name: 'img.png', ownerId: 2 },
    ]);

    expect(meta.length).toBe(2);

    // Remove second attachment while first is still embedding
    meta.delete(1, 1);
    expect(meta.length).toBe(1);
    expect(meta.get(0).embeddingStatus).toBe('processing');
  });

  it('should compute hasRagChunks correctly from Y.Array', () => {
    const meta = ydoc.getArray<any>('chat-attachments-meta');

    const checkHasRag = () => meta.toArray().some((m: any) => m.embeddingStatus === 'ready');

    // No attachments
    expect(checkHasRag()).toBe(false);

    // Processing
    meta.push([{ id: 'f1', embeddingStatus: 'processing' }]);
    expect(checkHasRag()).toBe(false);

    // Ready
    const item = meta.get(0);
    meta.delete(0, 1);
    meta.insert(0, [{ ...item, embeddingStatus: 'ready' }]);
    expect(checkHasRag()).toBe(true);
  });
});

// ─── Cross-Peer Message Ordering ────────────────────────────────────

describe('Cross-Peer Message Ordering in Threads', () => {
  it('should maintain insertion order across peers', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const msgs1 = doc1.getArray<any>('chat-messages');
    const msgs2 = doc2.getArray<any>('chat-messages');

    // Peer 1 sends first
    msgs1.push([{ id: 'msg-1', content: 'First', timestamp: 1000 }]);
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    // Peer 2 sends second
    msgs2.push([{ id: 'msg-2', content: 'Second', timestamp: 2000 }]);
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

    // Both should see same order
    expect(msgs1.length).toBe(2);
    expect(msgs2.length).toBe(2);
    expect(msgs1.get(0).content).toBe('First');
    expect(msgs1.get(1).content).toBe('Second');
    expect(msgs2.get(0).content).toBe('First');
    expect(msgs2.get(1).content).toBe('Second');

    doc1.destroy();
    doc2.destroy();
  });

  it('should handle simultaneous sends from two peers', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const msgs1 = doc1.getArray<any>('chat-messages');
    const msgs2 = doc2.getArray<any>('chat-messages');

    // Both peers send simultaneously (before sync)
    msgs1.push([{ id: 'msg-a', content: 'From A' }]);
    msgs2.push([{ id: 'msg-b', content: 'From B' }]);

    // Sync
    const update1 = Y.encodeStateAsUpdate(doc1);
    const update2 = Y.encodeStateAsUpdate(doc2);
    Y.applyUpdate(doc1, update2);
    Y.applyUpdate(doc2, update1);

    // Both should have both messages (order determined by Yjs conflict resolution)
    expect(msgs1.length).toBe(2);
    expect(msgs2.length).toBe(2);

    // Messages should be in same order on both peers
    const order1 = msgs1.toArray().map((m: any) => m.id);
    const order2 = msgs2.toArray().map((m: any) => m.id);
    expect(order1).toEqual(order2);

    doc1.destroy();
    doc2.destroy();
  });

  it('should handle clear + send race condition', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const msgs1 = doc1.getArray<any>('chat-messages');
    const msgs2 = doc2.getArray<any>('chat-messages');

    // Add some messages and sync
    msgs1.push([{ id: 'old-1' }, { id: 'old-2' }]);
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    // Peer 1 clears while peer 2 sends
    msgs1.delete(0, msgs1.length);
    msgs2.push([{ id: 'new-1' }]);

    // Sync
    const update1 = Y.encodeStateAsUpdate(doc1);
    const update2 = Y.encodeStateAsUpdate(doc2);
    Y.applyUpdate(doc1, update2);
    Y.applyUpdate(doc2, update1);

    // Both should converge to same state
    const final1 = msgs1.toArray().map((m: any) => m.id);
    const final2 = msgs2.toArray().map((m: any) => m.id);
    expect(final1).toEqual(final2);

    doc1.destroy();
    doc2.destroy();
  });
});

// ─── Send Request CRDT Coordination ─────────────────────────────────

describe('Send Request CRDT Coordination', () => {
  let ydoc: Y.Doc;

  beforeEach(() => {
    ydoc = new Y.Doc();
  });

  afterEach(() => {
    ydoc.destroy();
  });

  it('should use per-thread send request maps', () => {
    const defaultRequest = ydoc.getMap<any>('chat-send-request');
    const thread2Request = ydoc.getMap<any>('chat-send-request-thread-2');

    defaultRequest.set('id', 'req-1');
    thread2Request.set('id', 'req-2');

    expect(defaultRequest.get('id')).toBe('req-1');
    expect(thread2Request.get('id')).toBe('req-2');
  });

  it('should not interfere between thread send requests', () => {
    const defaultRequest = ydoc.getMap<any>('chat-send-request');
    const thread2Request = ydoc.getMap<any>('chat-send-request-thread-2');

    defaultRequest.set('id', 'req-1');
    defaultRequest.set('handledBy', 42);

    expect(thread2Request.get('id')).toBeUndefined();
    expect(thread2Request.get('handledBy')).toBeUndefined();
  });

  it('should clean up send request after handling', () => {
    const request = ydoc.getMap<any>('chat-send-request');

    request.set('id', 'req-1');
    request.set('prompt', 'Hello');
    request.set('requestedBy', 1);

    // Handle
    request.set('handledBy', 2);
    expect(request.get('handledBy')).toBe(2);

    // Cleanup
    request.delete('id');
    request.delete('prompt');
    request.delete('requestedBy');
    request.delete('handledBy');

    expect(request.size).toBe(0);
  });
});

// ─── Thread Presence via Awareness ──────────────────────────────────

describe('Thread Presence via Awareness', () => {
  it('should track which thread each peer is in', () => {
    // Simulate awareness states from multiple peers
    const awarenessStates = new Map<number, any>([
      [1, { user: { name: 'Alice', color: '#FF0000' }, activeThread: 'default' }],
      [2, { user: { name: 'Bob', color: '#00FF00' }, activeThread: 'thread-2' }],
      [3, { user: { name: 'Charlie', color: '#0000FF' }, activeThread: 'default' }],
    ]);

    const myId = 1;
    const presenceMap: Record<string, Array<{name: string; color: string}>> = {};

    awarenessStates.forEach((state, clientId) => {
      if (clientId === myId || !state.user?.name) return;
      const threadId = state.activeThread || 'default';
      if (!presenceMap[threadId]) presenceMap[threadId] = [];
      presenceMap[threadId].push({ name: state.user.name, color: state.user.color });
    });

    expect(presenceMap['default']?.length).toBe(1);
    expect(presenceMap['default']?.[0].name).toBe('Charlie');
    expect(presenceMap['thread-2']?.length).toBe(1);
    expect(presenceMap['thread-2']?.[0].name).toBe('Bob');
  });

  it('should handle all peers in the same thread', () => {
    const awarenessStates = new Map<number, any>([
      [1, { user: { name: 'Alice', color: '#FF0000' }, activeThread: 'default' }],
      [2, { user: { name: 'Bob', color: '#00FF00' }, activeThread: 'default' }],
      [3, { user: { name: 'Charlie', color: '#0000FF' }, activeThread: 'default' }],
    ]);

    const myId = 1;
    const presenceMap: Record<string, Array<{name: string; color: string}>> = {};

    awarenessStates.forEach((state, clientId) => {
      if (clientId === myId || !state.user?.name) return;
      const threadId = state.activeThread || 'default';
      if (!presenceMap[threadId]) presenceMap[threadId] = [];
      presenceMap[threadId].push({ name: state.user.name, color: state.user.color });
    });

    expect(presenceMap['default']?.length).toBe(2);
  });

  it('should track typing status per thread', () => {
    const awarenessStates = new Map<number, any>([
      [1, { user: { name: 'Alice' }, activeThread: 'default', chatTyping: null }],
      [2, { user: { name: 'Bob' }, activeThread: 'default', chatTyping: 'default' }],
      [3, { user: { name: 'Charlie' }, activeThread: 'thread-2', chatTyping: 'thread-2' }],
    ]);

    const myId = 1;
    const typingMap: Record<string, string[]> = {};

    awarenessStates.forEach((state, clientId) => {
      if (clientId === myId || !state.user?.name) return;
      if (state.chatTyping) {
        if (!typingMap[state.chatTyping]) typingMap[state.chatTyping] = [];
        typingMap[state.chatTyping].push(state.user.name);
      }
    });

    expect(typingMap['default']?.length).toBe(1);
    expect(typingMap['default']?.[0]).toBe('Bob');
    expect(typingMap['thread-2']?.length).toBe(1);
    expect(typingMap['thread-2']?.[0]).toBe('Charlie');
  });

  it('should handle no typing peers', () => {
    const awarenessStates = new Map<number, any>([
      [1, { user: { name: 'Alice' }, activeThread: 'default', chatTyping: null }],
      [2, { user: { name: 'Bob' }, activeThread: 'default', chatTyping: null }],
    ]);

    const myId = 1;
    const typingMap: Record<string, string[]> = {};

    awarenessStates.forEach((state, clientId) => {
      if (clientId === myId || !state.user?.name) return;
      if (state.chatTyping) {
        if (!typingMap[state.chatTyping]) typingMap[state.chatTyping] = [];
        typingMap[state.chatTyping].push(state.user.name);
      }
    });

    expect(Object.keys(typingMap).length).toBe(0);
  });

  it('should handle peer switching threads', () => {
    // Simulate Bob switching from default to thread-2
    const buildPresence = (states: Map<number, any>, myId: number) => {
      const presenceMap: Record<string, Array<{name: string; color: string}>> = {};
      states.forEach((state, clientId) => {
        if (clientId === myId || !state.user?.name) return;
        const threadId = state.activeThread || 'default';
        if (!presenceMap[threadId]) presenceMap[threadId] = [];
        presenceMap[threadId].push({ name: state.user.name, color: state.user.color || '#999' });
      });
      return presenceMap;
    };

    // Before switch
    const statesBefore = new Map<number, any>([
      [1, { user: { name: 'Alice' }, activeThread: 'default' }],
      [2, { user: { name: 'Bob' }, activeThread: 'default' }],
    ]);

    let presence = buildPresence(statesBefore, 1);
    expect(presence['default']?.length).toBe(1);
    expect(presence['thread-2']).toBeUndefined();

    // After Bob switches
    const statesAfter = new Map<number, any>([
      [1, { user: { name: 'Alice' }, activeThread: 'default' }],
      [2, { user: { name: 'Bob' }, activeThread: 'thread-2' }],
    ]);

    presence = buildPresence(statesAfter, 1);
    expect(presence['default']).toBeUndefined();
    expect(presence['thread-2']?.length).toBe(1);
    expect(presence['thread-2']?.[0].name).toBe('Bob');
  });

  it('should exclude self from presence dots', () => {
    const states = new Map<number, any>([
      [1, { user: { name: 'Alice' }, activeThread: 'default' }],
      [2, { user: { name: 'Bob' }, activeThread: 'default' }],
    ]);

    const myId = 1;
    const presenceMap: Record<string, Array<{name: string; color: string}>> = {};

    states.forEach((state, clientId) => {
      if (clientId === myId || !state.user?.name) return;
      const threadId = state.activeThread || 'default';
      if (!presenceMap[threadId]) presenceMap[threadId] = [];
      presenceMap[threadId].push({ name: state.user.name, color: state.user.color || '#999' });
    });

    // Alice (self) should NOT appear in presence
    expect(presenceMap['default']?.length).toBe(1);
    expect(presenceMap['default']?.find(p => p.name === 'Alice')).toBeUndefined();
    expect(presenceMap['default']?.[0].name).toBe('Bob');
  });

  it('should cap visible presence dots at 3 with overflow count', () => {
    const peers = [
      { name: 'Bob', color: '#00FF00' },
      { name: 'Charlie', color: '#0000FF' },
      { name: 'Diana', color: '#FF00FF' },
      { name: 'Eve', color: '#FFFF00' },
      { name: 'Frank', color: '#00FFFF' },
    ];

    const visible = peers.slice(0, 3);
    const overflowCount = peers.length - 3;

    expect(visible.length).toBe(3);
    expect(overflowCount).toBe(2);
    expect(visible[0].name).toBe('Bob');
  });

  it('should default to "default" thread for peers without activeThread', () => {
    const states = new Map<number, any>([
      [1, { user: { name: 'Alice' }, activeThread: 'default' }],
      [2, { user: { name: 'Bob' } }], // No activeThread set
    ]);

    const myId = 1;
    const presenceMap: Record<string, Array<{name: string; color: string}>> = {};

    states.forEach((state, clientId) => {
      if (clientId === myId || !state.user?.name) return;
      const threadId = state.activeThread || 'default';
      if (!presenceMap[threadId]) presenceMap[threadId] = [];
      presenceMap[threadId].push({ name: state.user.name, color: state.user.color || '#999' });
    });

    // Bob should appear in default thread
    expect(presenceMap['default']?.length).toBe(1);
    expect(presenceMap['default']?.[0].name).toBe('Bob');
  });
});
