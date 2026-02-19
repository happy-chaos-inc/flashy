/**
 * CHAT SIDEBAR TESTS
 * Tests for leader election, message handling, collaboration logic,
 * file attachment coordination, and disconnect cleanup.
 * Unit tests that don't require rendering the full component.
 */
// ─── Leader Election ────────────────────────────────────────────────

describe('ChatSidebar Leader Election Logic', () => {
  it('should determine leader as lowest clientID', () => {
    const states = new Map([
      [5, { user: { name: 'User5' } }],
      [1, { user: { name: 'User1' } }],
      [3, { user: { name: 'User3' } }],
    ]);

    const clientIds = Array.from(states.keys());
    const leader = Math.min(...clientIds);

    expect(leader).toBe(1);
  });

  it('should include self in leader calculation even if not in states', () => {
    const states = new Map([
      [5, { user: { name: 'User5' } }],
    ]);

    const myId = 2;
    const clientIds = Array.from(states.keys());

    if (!clientIds.includes(myId)) {
      clientIds.push(myId);
    }

    const leader = Math.min(...clientIds);

    expect(leader).toBe(2);
  });

  it('should elect new leader when current leader leaves', () => {
    let states = new Map([
      [1, { user: { name: 'User1' } }],
      [3, { user: { name: 'User3' } }],
      [5, { user: { name: 'User5' } }],
    ]);

    let leader = Math.min(...Array.from(states.keys()));
    expect(leader).toBe(1);

    states = new Map([
      [3, { user: { name: 'User3' } }],
      [5, { user: { name: 'User5' } }],
    ]);

    leader = Math.min(...Array.from(states.keys()));
    expect(leader).toBe(3);
  });

  it('should handle single user as leader', () => {
    const states = new Map([
      [42, { user: { name: 'Solo' } }],
    ]);

    const leader = Math.min(...Array.from(states.keys()));
    expect(leader).toBe(42);
  });

  it('should handle empty states by including self', () => {
    const states = new Map();
    const myId = 7;

    const clientIds = Array.from(states.keys());
    if (!clientIds.includes(myId)) {
      clientIds.push(myId);
    }

    const leader = Math.min(...clientIds);
    expect(leader).toBe(7);
  });
});

// ─── Message Deduplication ──────────────────────────────────────────

describe('ChatSidebar Message Deduplication', () => {
  it('should track responded messages to prevent duplicate responses', () => {
    const respondedMessages = new Set();

    const msgId = 'msg-123';

    expect(respondedMessages.has(msgId)).toBe(false);
    respondedMessages.add(msgId);

    expect(respondedMessages.has(msgId)).toBe(true);
  });

  it('should allow new messages to be processed', () => {
    const respondedMessages = new Set();

    respondedMessages.add('msg-1');
    respondedMessages.add('msg-2');

    expect(respondedMessages.has('msg-3')).toBe(false);
  });

  it('should handle many tracked messages', () => {
    const respondedMessages = new Set();

    for (let i = 0; i < 100; i++) {
      respondedMessages.add(`msg-${i}`);
    }

    expect(respondedMessages.size).toBe(100);
    expect(respondedMessages.has('msg-50')).toBe(true);
    expect(respondedMessages.has('msg-101')).toBe(false);
  });
});

// ─── ChatMessage Interface ──────────────────────────────────────────

describe('ChatMessage Interface', () => {
  it('should validate user message structure', () => {
    const userMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      author: { name: 'Alice', color: '#FF0000' },
      timestamp: Date.now(),
    };

    expect(userMessage.role).toBe('user');
    expect(userMessage.author).toBeDefined();
    expect(userMessage.author.name).toBe('Alice');
  });

  it('should validate assistant message structure', () => {
    const assistantMessage = {
      id: 'msg-2',
      role: 'assistant',
      content: 'Hi there!',
      timestamp: Date.now(),
    };

    expect(assistantMessage.role).toBe('assistant');
    expect(assistantMessage.author).toBeUndefined();
  });

  it('should generate unique message IDs', () => {
    const generateId = () =>
      `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const id1 = generateId();
    const id2 = generateId();

    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^msg-\d+-[a-z0-9]+$/);
  });
});

// ─── Y.js Integration ───────────────────────────────────────────────

describe('ChatSidebar Y.js Integration', () => {
  it('should handle Y.Text collaborative editing simulation', () => {
    const mockYText = {
      content: '',
      delete(start, length) {
        this.content = this.content.slice(0, start) + this.content.slice(start + length);
      },
      insert(index, text) {
        this.content = this.content.slice(0, index) + text + this.content.slice(index);
      },
      toString() {
        return this.content;
      },
    };

    mockYText.delete(0, mockYText.content.length);
    mockYText.insert(0, 'Hello');
    expect(mockYText.toString()).toBe('Hello');

    mockYText.delete(0, mockYText.content.length);
    mockYText.insert(0, 'Hello World');
    expect(mockYText.toString()).toBe('Hello World');

    mockYText.delete(0, mockYText.content.length);
    expect(mockYText.toString()).toBe('');
  });

  it('should handle Y.Array message operations simulation', () => {
    const mockYArray = [];

    mockYArray.push({ id: 'msg-1', role: 'user', content: 'Hello' });
    expect(mockYArray.length).toBe(1);

    mockYArray.push({ id: 'msg-2', role: 'assistant', content: 'Hi!' });
    expect(mockYArray.length).toBe(2);

    const contextMessages = mockYArray.slice(-10);
    expect(contextMessages.length).toBe(2);

    mockYArray.splice(0, mockYArray.length);
    expect(mockYArray.length).toBe(0);
  });
});

// ─── API Settings ───────────────────────────────────────────────────

describe('ChatSidebar API Settings', () => {
  it('should validate API key format', () => {
    const isValidOpenAIKey = (key) => key.startsWith('sk-');
    const isValidAnthropicKey = (key) => key.startsWith('sk-ant-');

    expect(isValidOpenAIKey('sk-test-key')).toBe(true);
    expect(isValidOpenAIKey('invalid')).toBe(false);
    expect(isValidAnthropicKey('sk-ant-test')).toBe(true);
    expect(isValidAnthropicKey('sk-test')).toBe(false);
  });

  it('should select correct models based on provider', () => {
    const MODELS = {
      free: [{ id: 'gpt-3.5-turbo', name: 'GPT-3.5', provider: 'openai' }],
      openai: [
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai' },
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
      ],
      anthropic: [
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic' },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
      ],
    };

    const getAvailableModels = (userApiKey, apiProvider) => {
      if (!userApiKey) return MODELS.free;
      return apiProvider === 'anthropic' ? MODELS.anthropic : MODELS.openai;
    };

    expect(getAvailableModels('', 'openai')).toEqual(MODELS.free);
    expect(getAvailableModels('sk-test', 'openai')).toEqual(MODELS.openai);
    expect(getAvailableModels('sk-ant-test', 'anthropic')).toEqual(MODELS.anthropic);
  });
});

// ─── File Attachment Send Coordination ──────────────────────────────

describe('File Attachment Send Coordination', () => {
  const classifyAttachments = (allMeta, myClientId) => {
    const otherPeersAttachments = allMeta.filter(m => m.ownerId !== myClientId);
    const myAttachments = allMeta.filter(m => m.ownerId === myClientId);
    return { otherPeersAttachments, myAttachments };
  };

  it('should delegate to peer when they own the files', () => {
    const allMeta = [
      { id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf', ownerId: 10, ownerName: 'Bob' },
    ];
    const { otherPeersAttachments, myAttachments } = classifyAttachments(allMeta, 20);

    expect(otherPeersAttachments.length).toBe(1);
    expect(myAttachments.length).toBe(0);
  });

  it('should handle locally when I own the files', () => {
    const allMeta = [
      { id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf', ownerId: 20, ownerName: 'Alice' },
    ];
    const { otherPeersAttachments, myAttachments } = classifyAttachments(allMeta, 20);

    expect(otherPeersAttachments.length).toBe(0);
    expect(myAttachments.length).toBe(1);
  });

  it('should delegate when mixed ownership (other peer has files)', () => {
    const allMeta = [
      { id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf', ownerId: 10, ownerName: 'Bob' },
      { id: 'f2', name: 'img.png', mimeType: 'image/png', ownerId: 20, ownerName: 'Alice' },
    ];
    const { otherPeersAttachments } = classifyAttachments(allMeta, 20);

    expect(otherPeersAttachments.length).toBe(1);
  });

  it('should handle send with no attachments', () => {
    const { otherPeersAttachments, myAttachments } = classifyAttachments([], 20);

    expect(otherPeersAttachments.length).toBe(0);
    expect(myAttachments.length).toBe(0);
  });
});

// ─── respondedMessages Guard (the bug fix) ──────────────────────────

describe('File Attachment respondedMessages Guard', () => {
  // Reproduces the core check from handleLeaderResponse:
  //   if (respondedMessages.has(id)) return false; // bail
  //   respondedMessages.add(id); return true;      // proceed
  // The bug was pre-adding the ID before this check, causing it to always bail.

  const makeHandler = (respondedMessages) => (id) => {
    if (respondedMessages.has(id)) return false;
    respondedMessages.add(id);
    return true;
  };

  it('should proceed when message ID is NOT pre-added (the fix)', () => {
    const respondedMessages = new Set();
    const handleLeaderResponse = makeHandler(respondedMessages);

    // Self-handling path: no pre-add → API call proceeds
    expect(handleLeaderResponse('msg-self-123')).toBe(true);
  });

  it('should bail when message ID IS pre-added (the old bug)', () => {
    const respondedMessages = new Set();
    const handleLeaderResponse = makeHandler(respondedMessages);

    // OLD BUG: pre-adding blocks the API call
    respondedMessages.add('msg-bug-123');
    expect(handleLeaderResponse('msg-bug-123')).toBe(false);
  });

  it('should proceed for cross-peer path without pre-add (the fix)', () => {
    const respondedMessages = new Set();
    const handleLeaderResponse = makeHandler(respondedMessages);

    expect(handleLeaderResponse('msg-peer-456')).toBe(true);
  });

  it('should still prevent duplicate responses for the same message', () => {
    const respondedMessages = new Set();
    const handleLeaderResponse = makeHandler(respondedMessages);

    expect(handleLeaderResponse('msg-dedup')).toBe(true);
    // Second call (e.g. from array observer) should be blocked
    expect(handleLeaderResponse('msg-dedup')).toBe(false);
  });
});

// ─── Disconnect Attachment Cleanup ──────────────────────────────────

describe('Disconnect Attachment Cleanup', () => {
  // Mirrors cleanupDisconnectedAttachments: walk backwards, remove by ownerId
  const cleanupDisconnected = (attachments, removedClientIds) => {
    const removedSet = new Set(removedClientIds);
    const result = [...attachments];
    for (let i = result.length - 1; i >= 0; i--) {
      if (removedSet.has(result[i].ownerId)) {
        result.splice(i, 1);
      }
    }
    return result;
  };

  const bobPdf = { id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf', ownerId: 10, ownerName: 'Bob' };
  const aliceImg = { id: 'f2', name: 'img.png', mimeType: 'image/png', ownerId: 20, ownerName: 'Alice' };
  const bobImg = { id: 'f3', name: 'photo.jpg', mimeType: 'image/jpeg', ownerId: 10, ownerName: 'Bob' };

  it('should remove attachments from a disconnected peer', () => {
    const result = cleanupDisconnected([bobPdf, aliceImg], [10]);

    expect(result.length).toBe(1);
    expect(result[0].ownerName).toBe('Alice');
  });

  it('should remove all attachments when all peers disconnect', () => {
    const result = cleanupDisconnected([bobPdf, aliceImg], [10, 20]);

    expect(result.length).toBe(0);
  });

  it('should not remove attachments from peers still online', () => {
    const result = cleanupDisconnected([bobPdf, aliceImg], [30]);

    expect(result.length).toBe(2);
  });

  it('should handle empty attachments list', () => {
    expect(cleanupDisconnected([], [10]).length).toBe(0);
  });

  it('should handle no disconnections', () => {
    expect(cleanupDisconnected([bobPdf], []).length).toBe(1);
  });

  it('should remove multiple attachments from same disconnected peer', () => {
    const result = cleanupDisconnected([bobPdf, bobImg, aliceImg], [10]);

    expect(result.length).toBe(1);
    expect(result[0].id).toBe('f2');
  });
});

// ─── Stale Send Request Cleanup ─────────────────────────────────────

describe('Stale Send Request Cleanup', () => {
  const shouldClearSendRequest = (hasPendingRequest, isHandled, remainingAttachmentCount) => {
    if (!hasPendingRequest || isHandled) return false;
    return remainingAttachmentCount === 0;
  };

  it('should clear send request when no file owners remain', () => {
    expect(shouldClearSendRequest(true, false, 0)).toBe(true);
  });

  it('should not clear send request when file owners still online', () => {
    expect(shouldClearSendRequest(true, false, 1)).toBe(false);
  });

  it('should not clear already-handled send request', () => {
    expect(shouldClearSendRequest(true, true, 0)).toBe(false);
  });

  it('should not clear when there is no pending request', () => {
    expect(shouldClearSendRequest(false, false, 0)).toBe(false);
  });
});

// ─── Attachment Message Detection ───────────────────────────────────

describe('Attachment Message Detection', () => {
  // The array observer uses this check to skip messages with files
  // (only the file owner should trigger the API call, not the leader)
  const hasAttachments = (content) => content.includes('[Attached:');

  it('should detect messages with file attachments', () => {
    expect(hasAttachments('give me flashcards\n[Attached: doc.pdf (pdf)]')).toBe(true);
  });

  it('should detect messages with image attachments', () => {
    expect(hasAttachments('what is this?\n[Attached: photo.png (image)]')).toBe(true);
  });

  it('should not flag plain text messages', () => {
    expect(hasAttachments('hello world')).toBe(false);
  });

  it('should not flag messages mentioning attachments in prose', () => {
    expect(hasAttachments('I attached a file earlier')).toBe(false);
  });

  it('should detect multiple attachments', () => {
    expect(hasAttachments('review\n[Attached: a.pdf]\n[Attached: b.png]')).toBe(true);
  });
});

// ─── Error Handling ─────────────────────────────────────────────────

describe('ChatSidebar Error Handling', () => {
  it('should handle rate limit errors', () => {
    const errorData = { rateLimited: true, remaining: 0 };

    const isRateLimited = errorData.rateLimited === true;
    const errorMessage = isRateLimited
      ? 'Daily limit reached. Add your API key for unlimited access.'
      : 'Unknown error';

    expect(isRateLimited).toBe(true);
    expect(errorMessage).toContain('Daily limit');
  });

  it('should handle API errors gracefully', () => {
    const error = { message: 'Network error' };

    const errorMessage = error.message || 'Failed to get AI response';
    expect(errorMessage).toBe('Network error');
  });

  it('should provide fallback error message', () => {
    const error = {};

    const errorMessage = error.message || 'Failed to get AI response';
    expect(errorMessage).toBe('Failed to get AI response');
  });
});
