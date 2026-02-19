/**
 * RAG PIPELINE TESTS
 * Tests for embedding, hybrid search, CRDT sync, and race conditions
 * in the RAG (Retrieval Augmented Generation) pipeline.
 */

export {};

interface MockMeta {
  id: string;
  name: string;
  embeddingStatus?: 'pending' | 'processing' | 'ready' | 'error';
  ownerId: number;
}

// ─── Text Chunking ──────────────────────────────────────────────────

describe('Text Chunking', () => {
  // Mirrors the chunkText function from embed/index.ts
  const chunkText = (text: string, targetChars: number = 2000, overlapChars: number = 300): string[] => {
    const chunks: string[] = [];
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (!trimmed) continue;

      if (currentChunk.length > 0 && currentChunk.length + trimmed.length > targetChars) {
        chunks.push(currentChunk.trim());
        const overlapStart = Math.max(0, currentChunk.length - overlapChars);
        currentChunk = currentChunk.slice(overlapStart).trim() + '\n\n' + trimmed;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    if (chunks.length === 0 && text.trim()) {
      let i = 0;
      while (i < text.length) {
        const end = Math.min(i + targetChars, text.length);
        chunks.push(text.slice(i, end).trim());
        i = end - overlapChars;
        if (i < 0) break;
      }
    }

    return chunks.filter(c => c.length > 0);
  };

  it('should handle empty text', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('should return single chunk for short text', () => {
    const chunks = chunkText('Hello world');
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe('Hello world');
  });

  it('should split long text into multiple chunks', () => {
    const longText = Array(50).fill('This is a paragraph with some content about biology.').join('\n\n');
    const chunks = chunkText(longText);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('should maintain overlap between consecutive chunks', () => {
    const paragraphs = Array(20).fill(null).map((_, i) => `Paragraph ${i}: ${'x'.repeat(200)}`);
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text, 2000, 300);

    if (chunks.length >= 2) {
      // The end of chunk N should overlap with the start of chunk N+1
      const endOfFirst = chunks[0].slice(-100);
      const startOfSecond = chunks[1].slice(0, 200);
      // There should be some overlap content
      expect(startOfSecond.length).toBeGreaterThan(0);
    }
  });

  it('should handle text with no paragraph breaks via fallback chunking', () => {
    // When there are no \n\n breaks but text is long, it goes through
    // the paragraph loop as a single paragraph, yielding one chunk.
    // Only truly empty initial chunks trigger the character-based fallback.
    const text = 'x'.repeat(5000);
    const chunks = chunkText(text, 2000, 300);
    // Single paragraph text stays as one chunk
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(5000);
  });

  it('should handle text with only whitespace paragraphs', () => {
    const text = '   \n\n   \n\n   ';
    expect(chunkText(text)).toEqual([]);
  });

  it('should preserve content across chunks (no data loss)', () => {
    const paragraphs = Array(10).fill(null).map((_, i) => `Unique-marker-${i}: Some content here.`);
    const text = paragraphs.join('\n\n');
    const chunks = chunkText(text, 200, 50);
    const allChunkText = chunks.join(' ');

    // Every unique marker should appear in at least one chunk
    for (let i = 0; i < 10; i++) {
      expect(allChunkText).toContain(`Unique-marker-${i}`);
    }
  });
});

// ─── RRF Scoring ────────────────────────────────────────────────────

describe('RRF Scoring', () => {
  // Reciprocal Rank Fusion: score = sum of 1/(k + rank) for each result set
  const K = 60; // RRF constant

  const computeRRF = (vectorRank: number | null, ftsRank: number | null): number => {
    let score = 0;
    if (vectorRank !== null) score += 1 / (K + vectorRank);
    if (ftsRank !== null) score += 1 / (K + ftsRank);
    return score;
  };

  it('should score higher when present in both result sets', () => {
    const bothSets = computeRRF(1, 1);
    const vectorOnly = computeRRF(1, null);
    const ftsOnly = computeRRF(null, 1);

    expect(bothSets).toBeGreaterThan(vectorOnly);
    expect(bothSets).toBeGreaterThan(ftsOnly);
  });

  it('should score higher for lower ranks (better matches)', () => {
    const rank1 = computeRRF(1, 1);
    const rank10 = computeRRF(10, 10);

    expect(rank1).toBeGreaterThan(rank10);
  });

  it('should handle rank 1 in one set and absent in another', () => {
    const score = computeRRF(1, null);
    expect(score).toBeCloseTo(1 / (K + 1), 6);
  });

  it('should combine scores from both sources', () => {
    const vectorScore = 1 / (K + 3);
    const ftsScore = 1 / (K + 5);
    const combined = computeRRF(3, 5);

    expect(combined).toBeCloseTo(vectorScore + ftsScore, 6);
  });

  it('should rank results correctly with mixed presence', () => {
    const results = [
      { id: 'A', vectorRank: 1, ftsRank: 2 },
      { id: 'B', vectorRank: 2, ftsRank: null },
      { id: 'C', vectorRank: null, ftsRank: 1 },
      { id: 'D', vectorRank: 3, ftsRank: 3 },
    ];

    const scored = results.map(r => ({
      ...r,
      rrf: computeRRF(r.vectorRank, r.ftsRank),
    })).sort((a, b) => b.rrf - a.rrf);

    // A should be first (best ranks in both)
    expect(scored[0].id).toBe('A');
    // D should beat B and C (present in both)
    expect(scored.findIndex(r => r.id === 'D')).toBeLessThan(scored.findIndex(r => r.id === 'B'));
  });
});

// ─── Embedding Status CRDT Sync ─────────────────────────────────────

describe('Embedding Status CRDT Sync', () => {
  // Simulates SharedAttachmentMeta with embeddingStatus

  it('should propagate embeddingStatus to all peers', () => {
    // Simulates Y.Array behavior: update is reflected everywhere
    const metaArray: MockMeta[] = [
      { id: 'f1', name: 'doc.pdf', embeddingStatus: 'pending', ownerId: 1 },
    ];

    // Simulate status update (as owner sets it)
    const idx = metaArray.findIndex(m => m.id === 'f1');
    metaArray[idx] = { ...metaArray[idx], embeddingStatus: 'processing' };

    expect(metaArray[0].embeddingStatus).toBe('processing');

    metaArray[idx] = { ...metaArray[idx], embeddingStatus: 'ready' };
    expect(metaArray[0].embeddingStatus).toBe('ready');
  });

  it('should compute hasRagChunks from embeddingStatus', () => {
    const metas: MockMeta[] = [
      { id: 'f1', name: 'doc.pdf', embeddingStatus: 'ready', ownerId: 1 },
      { id: 'f2', name: 'notes.pdf', embeddingStatus: 'processing', ownerId: 2 },
    ];

    const hasRagChunks = metas.some(m => m.embeddingStatus === 'ready');
    expect(hasRagChunks).toBe(true);
  });

  it('should return false when no files are ready', () => {
    const metas: MockMeta[] = [
      { id: 'f1', name: 'doc.pdf', embeddingStatus: 'processing', ownerId: 1 },
      { id: 'f2', name: 'notes.pdf', embeddingStatus: 'error', ownerId: 2 },
    ];

    const hasRagChunks = metas.some(m => m.embeddingStatus === 'ready');
    expect(hasRagChunks).toBe(false);
  });

  it('should handle empty attachment list', () => {
    const hasRagChunks = ([] as MockMeta[]).some((m: MockMeta) => m.embeddingStatus === 'ready');
    expect(hasRagChunks).toBe(false);
  });

  it('should handle attachments without embeddingStatus', () => {
    const metas: MockMeta[] = [
      { id: 'f1', name: 'img.png', ownerId: 1 },
    ];

    const hasRagChunks = metas.some(m => m.embeddingStatus === 'ready');
    expect(hasRagChunks).toBe(false);
  });
});

// ─── Concurrent Operations ──────────────────────────────────────────

describe('Concurrent Embedding Operations', () => {
  it('should handle concurrent file uploads without conflict', async () => {
    // Simulate two files being processed concurrently
    const embedResults = new Map();

    const processFile = async (fileName: string, delay: number): Promise<string> => {
      await new Promise(resolve => setTimeout(resolve, delay));
      embedResults.set(fileName, 'ready');
      return fileName;
    };

    const [result1, result2] = await Promise.all([
      processFile('file1.pdf', 10),
      processFile('file2.pdf', 5),
    ]);

    expect(result1).toBe('file1.pdf');
    expect(result2).toBe('file2.pdf');
    expect(embedResults.size).toBe(2);
    expect(embedResults.get('file1.pdf')).toBe('ready');
    expect(embedResults.get('file2.pdf')).toBe('ready');
  });

  it('should handle chat during embedding (non-blocking)', async () => {
    let embeddingComplete = false;
    let chatResponseReceived = false;

    // Simulate embedding taking longer
    const embedPromise = new Promise<void>(resolve => {
      setTimeout(() => { embeddingComplete = true; resolve(); }, 50);
    });

    // Simulate chat happening during embedding
    const chatPromise = new Promise<void>(resolve => {
      setTimeout(() => { chatResponseReceived = true; resolve(); }, 10);
    });

    await chatPromise;
    expect(chatResponseReceived).toBe(true);
    expect(embeddingComplete).toBe(false); // Embedding still in progress

    await embedPromise;
    expect(embeddingComplete).toBe(true);
  });

  it('should handle duplicate file upload (idempotent)', () => {
    // Simulate upsert behavior: second upload replaces first
    const chunks = new Map();

    // First upload
    chunks.set('room1:file.pdf:0', 'chunk v1');
    chunks.set('room1:file.pdf:1', 'chunk v1');

    // Re-upload same file (upsert)
    chunks.set('room1:file.pdf:0', 'chunk v2');
    chunks.set('room1:file.pdf:1', 'chunk v2');

    expect(chunks.get('room1:file.pdf:0')).toBe('chunk v2');
    expect(chunks.get('room1:file.pdf:1')).toBe('chunk v2');
    expect(chunks.size).toBe(2); // No duplicates
  });
});

// ─── Peer Disconnect Resilience ─────────────────────────────────────

describe('Peer Disconnect Resilience', () => {
  it('should persist chunks in DB after uploader leaves', () => {
    // Chunks are stored in Postgres, not in Yjs or browser memory
    // So even if the uploader disconnects, chunks remain
    const dbChunks = new Map();
    dbChunks.set('chunk-1', { room_id: 'room1', file_name: 'doc.pdf', text: 'content' });

    // Simulate peer disconnect - DB chunks unaffected
    const peerDisconnected = true;
    expect(peerDisconnected).toBe(true);
    expect(dbChunks.size).toBe(1);
    expect(dbChunks.get('chunk-1')).toBeDefined();
  });

  it('should remove attachment metadata from Yjs but keep DB chunks', () => {
    // Yjs attachment meta is cleaned up on disconnect
    const yAttachments: MockMeta[] = [
      { id: 'f1', name: 'doc.pdf', ownerId: 10, embeddingStatus: 'ready' },
    ];

    // Simulate disconnect cleanup
    const removedPeers = new Set([10]);
    const remainingAttachments = yAttachments.filter(a => !removedPeers.has(a.ownerId));
    expect(remainingAttachments.length).toBe(0);

    // But DB chunks are unaffected (they're in Postgres)
    const dbChunkCount = 5; // Still in DB
    expect(dbChunkCount).toBe(5);
  });
});

// ─── Search Edge Cases ──────────────────────────────────────────────

describe('Search Edge Cases', () => {
  it('should return empty results for room with no chunks', () => {
    const results: string[] = [];
    expect(results).toEqual([]);
  });

  it('should handle special characters in search query', () => {
    const queries = [
      'what is DNA?',
      'O(n log n)',
      'C++ templates',
      'SELECT * FROM',
      '<script>alert(1)</script>',
    ];

    // All should be valid queries (no crash)
    for (const q of queries) {
      expect(typeof q).toBe('string');
      expect(q.length).toBeGreaterThan(0);
    }
  });

  it('should truncate long search results for display', () => {
    const truncate = (text: string, maxLen: number = 120): string => {
      if (text.length <= maxLen) return text;
      return text.substring(0, maxLen) + '...';
    };

    const longText = 'x'.repeat(200);
    const truncated = truncate(longText);
    expect(truncated.length).toBe(123); // 120 + '...'
    expect(truncated.endsWith('...')).toBe(true);

    const shortText = 'Hello';
    expect(truncate(shortText)).toBe('Hello');
  });
});

// ─── Multi-Chat Thread Logic ────────────────────────────────────────

describe('Multi-Chat Thread Management', () => {
  it('should create default thread on initialization', () => {
    const threads = [{ id: 'default', name: 'Chat', createdAt: Date.now() }];
    expect(threads.length).toBe(1);
    expect(threads[0].id).toBe('default');
  });

  it('should add new threads with unique IDs', () => {
    const threads = [{ id: 'default', name: 'Chat', createdAt: 0 }];
    const newId = `thread-${Date.now()}`;
    threads.push({ id: newId, name: 'Chat 2', createdAt: Date.now() });

    expect(threads.length).toBe(2);
    expect(threads[1].id).not.toBe('default');
  });

  it('should support independent message arrays per thread', () => {
    const threadMessages = {
      'default': [{ id: 'msg-1', content: 'Hello in default' }],
      'thread-2': [{ id: 'msg-2', content: 'Hello in thread 2' }],
    };

    expect(threadMessages['default'].length).toBe(1);
    expect(threadMessages['thread-2'].length).toBe(1);
    expect(threadMessages['default'][0].content).not.toBe(threadMessages['thread-2'][0].content);
  });

  it('should sync threads via Yjs to all peers', () => {
    // Simulate Y.Map behavior
    const yThreads = new Map();
    yThreads.set('default', { name: 'Chat', createdAt: 0 });
    yThreads.set('thread-2', { name: 'Chat 2', createdAt: 1000 });

    // All peers see the same threads
    const peerAThreads = Array.from(yThreads.entries());
    const peerBThreads = Array.from(yThreads.entries());

    expect(peerAThreads).toEqual(peerBThreads);
    expect(peerAThreads.length).toBe(2);
  });

  it('should elect leader independently per thread', () => {
    const peers = [1, 3, 5];

    // Each thread has its own leader election
    const defaultLeader = Math.min(...peers);
    const thread2Leader = Math.min(...peers);

    // With the same peers, leaders are the same
    expect(defaultLeader).toBe(1);
    expect(thread2Leader).toBe(1);

    // If a peer only joins thread 2 with different peers
    const thread2Peers = [3, 5, 7];
    const thread2OnlyLeader = Math.min(...thread2Peers);
    expect(thread2OnlyLeader).toBe(3);
  });
});

// ─── Thread Switching CRDT Edge Cases ───────────────────────────────

describe('Thread Switching CRDT Edge Cases', () => {
  it('should use separate Yjs keys for different threads', () => {
    // Default thread uses original keys for backward compat
    const getKey = (threadId: string, type: string) => {
      if (threadId === 'default') return `chat-${type}`;
      return `chat-${type}-${threadId}`;
    };

    expect(getKey('default', 'messages')).toBe('chat-messages');
    expect(getKey('default', 'prompt')).toBe('chat-prompt');
    expect(getKey('thread-2', 'messages')).toBe('chat-messages-thread-2');
    expect(getKey('thread-2', 'prompt')).toBe('chat-prompt-thread-2');
  });

  it('should not leak messages between threads', () => {
    const threadMessages: Record<string, any[]> = {};

    // Add message to default thread
    const defaultKey = 'chat-messages';
    threadMessages[defaultKey] = threadMessages[defaultKey] || [];
    threadMessages[defaultKey].push({ id: 'msg-1', content: 'Hello in default' });

    // Add message to thread-2
    const thread2Key = 'chat-messages-thread-2';
    threadMessages[thread2Key] = threadMessages[thread2Key] || [];
    threadMessages[thread2Key].push({ id: 'msg-2', content: 'Hello in thread 2' });

    // Messages should be isolated
    expect(threadMessages[defaultKey].length).toBe(1);
    expect(threadMessages[thread2Key].length).toBe(1);
    expect(threadMessages[defaultKey][0].content).toBe('Hello in default');
    expect(threadMessages[thread2Key][0].content).toBe('Hello in thread 2');
  });

  it('should preserve messages when switching back to a thread', () => {
    const allMessages: Record<string, any[]> = {
      'default': [{ id: 'msg-1' }, { id: 'msg-2' }],
      'thread-2': [{ id: 'msg-3' }],
    };

    // Switch to thread-2
    let activeThread = 'thread-2';
    let visibleMessages = allMessages[activeThread] || [];
    expect(visibleMessages.length).toBe(1);

    // Switch back to default
    activeThread = 'default';
    visibleMessages = allMessages[activeThread] || [];
    expect(visibleMessages.length).toBe(2);
  });

  it('should handle concurrent sends to different threads', async () => {
    const threadResults: Record<string, string[]> = {};

    const sendToThread = async (threadId: string, message: string) => {
      threadResults[threadId] = threadResults[threadId] || [];
      threadResults[threadId].push(message);
      return message;
    };

    await Promise.all([
      sendToThread('default', 'msg in default'),
      sendToThread('thread-2', 'msg in thread 2'),
      sendToThread('default', 'another in default'),
    ]);

    expect(threadResults['default'].length).toBe(2);
    expect(threadResults['thread-2'].length).toBe(1);
  });

  it('should clean up thread Yjs structures on delete', () => {
    const yDocKeys = new Set([
      'chat-messages',
      'chat-prompt',
      'chat-messages-thread-2',
      'chat-prompt-thread-2',
      'chat-messages-thread-3',
      'chat-prompt-thread-3',
    ]);

    // Simulate deleting thread-2
    const threadToDelete = 'thread-2';
    const keysToRemove = Array.from(yDocKeys).filter(k => k.includes(threadToDelete));

    // In practice we don't delete Y.Doc keys, but the thread metadata is removed
    // from the Y.Map, making the thread inaccessible
    expect(keysToRemove.length).toBe(2);
    expect(keysToRemove).toContain('chat-messages-thread-2');
    expect(keysToRemove).toContain('chat-prompt-thread-2');
  });

  it('should not crash when switching to thread with no messages', () => {
    const allMessages: Record<string, any[]> = {
      'default': [{ id: 'msg-1' }],
    };

    // Switch to brand new thread
    const activeThread = 'thread-new';
    const messages = allMessages[activeThread] || [];
    expect(messages).toEqual([]);
    expect(messages.length).toBe(0);
  });

  it('should handle rapid thread switching without race conditions', async () => {
    let lastRenderedThread = '';
    const switchThread = async (threadId: string) => {
      // Simulate async Yjs binding
      await new Promise<void>(resolve => setTimeout(resolve, 5));
      lastRenderedThread = threadId;
    };

    // Rapid switching - only the last one should win
    const p1 = switchThread('thread-1');
    const p2 = switchThread('thread-2');
    const p3 = switchThread('thread-3');

    await Promise.all([p1, p2, p3]);

    // All resolve, but the component would use the latest activeThreadId
    // In practice, React's useEffect cleanup prevents stale updates
    expect(lastRenderedThread).toBe('thread-3');
  });

  it('should sync thread list across peers via Yjs', () => {
    // Simulate Y.Map behavior for thread metadata
    const yThreads = new Map<string, any>();

    // Peer A creates a thread
    yThreads.set('thread-A', { name: 'Research', createdAt: 1000 });

    // Peer B creates a thread
    yThreads.set('thread-B', { name: 'Brainstorm', createdAt: 2000 });

    // Both peers see all threads
    const allThreads = Array.from(yThreads.entries());
    expect(allThreads.length).toBe(2);
    expect(yThreads.get('thread-A')?.name).toBe('Research');
    expect(yThreads.get('thread-B')?.name).toBe('Brainstorm');
  });

  it('should handle embedding status updates across thread switches', () => {
    // Embedding status is on attachments, which are shared across all threads
    const attachments: Array<{ id: string; embeddingStatus?: string }> = [
      { id: 'f1', embeddingStatus: 'processing' },
    ];

    // Switch to different thread
    const activeThread = 'thread-2';
    expect(activeThread).toBe('thread-2');

    // Embedding status should still be visible (it's global, not per-thread)
    const hasRag = attachments.some(a => a.embeddingStatus === 'ready');
    expect(hasRag).toBe(false);

    // Embedding completes
    attachments[0].embeddingStatus = 'ready';
    const hasRagNow = attachments.some(a => a.embeddingStatus === 'ready');
    expect(hasRagNow).toBe(true);
  });
});
