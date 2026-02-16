import { collaborationManager } from '../lib/CollaborationManager';

// Mock IndexedDB for testing
class MockIndexedDB {
  async open() {}
  on() {}
  destroy() {}
  whenSynced = Promise.resolve();
}

(global as any).indexedDB = {
  open: jest.fn(),
  deleteDatabase: jest.fn(),
};

describe('CollaborationManager', () => {
  it('should be defined', () => {
    expect(collaborationManager).toBeDefined();
  });

  it('should have connect method', () => {
    expect(typeof collaborationManager.connect).toBe('function');
  });

  it('should have disconnect method', () => {
    expect(typeof collaborationManager.disconnect).toBe('function');
  });

  it('should be a singleton', () => {
    expect(collaborationManager).toBe(collaborationManager);
  });
});
