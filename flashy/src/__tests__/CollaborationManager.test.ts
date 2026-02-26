/**
 * COLLABORATION MANAGER TESTS
 * Tests for the singleton collaboration manager
 * Tests public API, singleton pattern, and Y.js integration
 */

import * as Y from 'yjs';

// Mock IndexedDB
(global as any).indexedDB = {
  open: jest.fn(),
  deleteDatabase: jest.fn(),
};

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(() => null),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
(global as any).localStorage = localStorageMock;

// Mock sessionStorage
const sessionStorageMock = {
  getItem: jest.fn(() => null),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
(global as any).sessionStorage = sessionStorageMock;

// Mock window
(global as any).window = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
};

// Create awareness mock with proper Map
const createMockAwareness = () => ({
  getStates: jest.fn(() => new Map([[1, { user: { name: 'Test', color: '#FF0000' } }]])),
  setLocalStateField: jest.fn(),
  setLocalState: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  destroy: jest.fn(),
  doc: { clientID: 1 },
  clientID: 1,
  getLocalState: jest.fn(() => ({ user: { name: 'Test', color: '#FF0000' } })),
});

const mockChannel = {
  on: jest.fn().mockReturnThis(),
  subscribe: jest.fn((callback) => {
    setTimeout(() => callback('SUBSCRIBED'), 10);
    return mockChannel;
  }),
  send: jest.fn(),
  unsubscribe: jest.fn(),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    channel: jest.fn(() => mockChannel),
    removeChannel: jest.fn(),
  })),
}));

jest.mock('../config/supabase', () => ({
  supabase: {
    channel: jest.fn(() => mockChannel),
    removeChannel: jest.fn(),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

jest.mock('../lib/DocumentPersistence', () => ({
  DocumentPersistence: jest.fn().mockImplementation(() => ({
    loadFromDatabase: jest.fn().mockResolvedValue(false),
    enableAutoSave: jest.fn(),
    saveNow: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn(),
    startPolling: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  })),
}));

jest.mock('../lib/SimpleSupabaseProvider', () => ({
  SimpleSupabaseProvider: jest.fn().mockImplementation((doc) => {
    const awareness = createMockAwareness();
    return {
      connect: jest.fn(),
      disconnect: jest.fn(),
      destroy: jest.fn(),
      connected: true,
      awareness,
      on: jest.fn(),
      off: jest.fn(),
    };
  }),
}));

jest.mock('../lib/userColors', () => ({
  generateUserInfo: jest.fn(() => ({
    userId: 'test-user-id',
    name: 'TestUser',
    color: '#4A90D9',
  })),
  USER_COLORS: ['#4A90D9', '#50C878', '#FF6B6B', '#FFD93D'],
}));

describe('CollaborationManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    localStorageMock.getItem.mockReturnValue(null);
    sessionStorageMock.getItem.mockReturnValue(null);
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Singleton Pattern', () => {
    it('should always return the same instance', async () => {
      const { collaborationManager: cm1 } = await import('../lib/CollaborationManager');
      const { collaborationManager: cm2 } = await import('../lib/CollaborationManager');
      expect(cm1).toBe(cm2);
    });

    it('should have all required public methods', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');
      expect(typeof collaborationManager.connect).toBe('function');
      expect(typeof collaborationManager.disconnect).toBe('function');
      expect(typeof collaborationManager.getRoomId).toBe('function');
      expect(typeof collaborationManager.getChatPrompt).toBe('function');
      expect(typeof collaborationManager.getChatMessages).toBe('function');
      expect(typeof collaborationManager.getUserInfo).toBe('function');
      expect(typeof collaborationManager.setUserColor).toBe('function');
      expect(typeof collaborationManager.onColorChange).toBe('function');
      expect(typeof collaborationManager.getUsedColors).toBe('function');
      expect(typeof collaborationManager.waitForDatabaseSync).toBe('function');
    });
  });

  describe('Connection Lifecycle', () => {
    it('should connect to default room when no roomId provided', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');

      const resultPromise = collaborationManager.connect();
      jest.advanceTimersByTime(600);
      const result = await resultPromise;

      expect(result).toHaveProperty('ydoc');
      expect(result).toHaveProperty('provider');
      expect(result).toHaveProperty('userInfo');
      expect(collaborationManager.getRoomId()).toBe('default');
    });

    it('should connect to specified room', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');

      const resultPromise = collaborationManager.connect('test-room');
      jest.advanceTimersByTime(600);
      await resultPromise;

      expect(collaborationManager.getRoomId()).toBe('test-room');
    });

    it('should return Y.Doc instance on connect', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');

      const resultPromise = collaborationManager.connect();
      jest.advanceTimersByTime(600);
      const result = await resultPromise;

      // Check it has Y.Doc methods instead of instanceof (avoids module duplication issues)
      expect(result.ydoc).toBeDefined();
      expect(typeof result.ydoc.getText).toBe('function');
      expect(typeof result.ydoc.getArray).toBe('function');
    });

    it('should return userInfo with name, color, and userId', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');

      const resultPromise = collaborationManager.connect();
      jest.advanceTimersByTime(600);
      const result = await resultPromise;

      expect(result.userInfo).toHaveProperty('name');
      expect(result.userInfo).toHaveProperty('color');
      expect(result.userInfo).toHaveProperty('userId');
    });
  });

  describe('Reference Counting', () => {
    it('should reuse existing connection for same room', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');

      const promise1 = collaborationManager.connect('room1');
      jest.advanceTimersByTime(600);
      const result1 = await promise1;

      const promise2 = collaborationManager.connect('room1');
      jest.advanceTimersByTime(600);
      const result2 = await promise2;

      expect(result1.ydoc).toBe(result2.ydoc);
      expect(result1.provider).toBe(result2.provider);
    });

    it('should handle disconnect gracefully', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');

      const promise = collaborationManager.connect();
      jest.advanceTimersByTime(600);
      await promise;

      // Should not throw on disconnect
      expect(() => collaborationManager.disconnect()).not.toThrow();

      // Room should still be tracked (cleanup is scheduled, not immediate)
      expect(collaborationManager.getRoomId()).toBeDefined();
    });
  });

  describe('Room Switching', () => {
    it('should cleanup old room when switching to new room', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');

      const promise1 = collaborationManager.connect('room1');
      jest.advanceTimersByTime(600);
      const result1 = await promise1;

      expect(collaborationManager.getRoomId()).toBe('room1');

      const promise2 = collaborationManager.connect('room2');
      jest.advanceTimersByTime(600);
      const result2 = await promise2;

      expect(collaborationManager.getRoomId()).toBe('room2');
      expect(result1.ydoc).not.toBe(result2.ydoc);
    });
  });

  describe('Chat Data Structures', () => {
    it('should return Y.Text for chat prompt', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');

      const promise = collaborationManager.connect();
      jest.advanceTimersByTime(600);
      await promise;

      const chatPrompt = collaborationManager.getChatPrompt();
      // Check it has Y.Text methods instead of instanceof (avoids module duplication issues)
      expect(chatPrompt).toBeDefined();
      expect(typeof chatPrompt.insert).toBe('function');
      expect(typeof chatPrompt.delete).toBe('function');
      expect(typeof chatPrompt.toString).toBe('function');
    });

    it('should return Y.Array for chat messages', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');

      const promise = collaborationManager.connect();
      jest.advanceTimersByTime(600);
      await promise;

      const chatMessages = collaborationManager.getChatMessages();
      // Check it has Y.Array methods instead of instanceof (avoids module duplication issues)
      expect(chatMessages).toBeDefined();
      expect(typeof chatMessages.push).toBe('function');
      expect(typeof chatMessages.delete).toBe('function');
      expect(typeof chatMessages.toArray).toBe('function');
    });

    it('should return null for chat structures when not connected', async () => {
      jest.resetModules();
      const { collaborationManager } = await import('../lib/CollaborationManager');

      expect(collaborationManager.getChatPrompt()).toBeNull();
      expect(collaborationManager.getChatMessages()).toBeNull();
    });
  });

  describe('Color Management', () => {
    it('should notify listeners when color changes', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');

      const promise = collaborationManager.connect();
      jest.advanceTimersByTime(600);
      await promise;

      const listener = jest.fn();
      collaborationManager.onColorChange(listener);

      collaborationManager.setUserColor('#FF0000');

      expect(listener).toHaveBeenCalledWith('#FF0000');
    });

    it('should allow unsubscribing from color changes', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');

      const promise = collaborationManager.connect();
      jest.advanceTimersByTime(600);
      await promise;

      const listener = jest.fn();
      const unsubscribe = collaborationManager.onColorChange(listener);

      unsubscribe();
      collaborationManager.setUserColor('#00FF00');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Connection State', () => {
    it('should wait for existing connection if in progress', async () => {
      const { collaborationManager } = await import('../lib/CollaborationManager');

      // Start two connections simultaneously
      const promise1 = collaborationManager.connect('room1');
      const promise2 = collaborationManager.connect('room1');

      jest.advanceTimersByTime(600);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Both should return the same connection
      expect(result1.ydoc).toBe(result2.ydoc);
    });
  });
});

describe('ChatMessage Interface', () => {
  it('should have correct shape', () => {
    interface ChatMessage {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      author?: { name: string; color: string };
      timestamp: number;
    }

    const userMessage: ChatMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      author: { name: 'Test', color: '#FF0000' },
      timestamp: Date.now(),
    };

    const assistantMessage: ChatMessage = {
      id: 'msg-2',
      role: 'assistant',
      content: 'Hi there!',
      timestamp: Date.now(),
    };

    expect(userMessage.role).toBe('user');
    expect(assistantMessage.role).toBe('assistant');
    expect(userMessage.author).toBeDefined();
    expect(assistantMessage.author).toBeUndefined();
  });
});
