/**
 * CRITICAL DATA LOSS PREVENTION TESTS
 * These tests ensure users NEVER lose their main document
 */

import * as Y from 'yjs';
import { DocumentPersistence } from '../lib/DocumentPersistence';
import { supabase } from '../config/supabase';

jest.mock('../config/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

describe('CRITICAL: Data Loss Prevention', () => {
  let doc: Y.Doc;
  let persistence: DocumentPersistence;

  beforeEach(() => {
    doc = new Y.Doc();
    persistence = new DocumentPersistence(doc);
    jest.clearAllMocks();
  });

  afterEach(() => {
    doc.destroy();
  });

  describe('Main Document Fetch on Startup', () => {
    it('CRITICAL: should preserve IndexedDB content when database load fails', async () => {
      // Simulate IndexedDB has local content
      const localContent = 'IMPORTANT LOCAL DATA - DO NOT LOSE';
      doc.getText('content').insert(0, localContent);
      const beforeLength = doc.getText('content').length;

      // Simulate database error
      (supabase.rpc as jest.Mock).mockRejectedValue(new Error('Network error'));

      // Load should fail gracefully
      const loaded = await persistence.loadFromDatabase();

      // CRITICAL: Local content must still be there
      expect(loaded).toBe(false);
      expect(doc.getText('content').toString()).toBe(localContent);
      expect(doc.getText('content').length).toBe(beforeLength);
    });

    it('CRITICAL: should preserve IndexedDB when database returns empty', async () => {
      // User has local edits
      const localContent = 'My offline work';
      doc.getText('content').insert(0, localContent);

      // Database returns empty
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: [],
        error: null,
      });

      await persistence.loadFromDatabase();

      // CRITICAL: Must not clear local content
      expect(doc.getText('content').toString()).toBe(localContent);
    });

    it('CRITICAL: should preserve IndexedDB when database returns null', async () => {
      const localContent = 'Local data must survive';
      doc.getText('content').insert(0, localContent);

      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: null,
      });

      await persistence.loadFromDatabase();

      expect(doc.getText('content').toString()).toBe(localContent);
    });

    it('CRITICAL: should preserve ALL IndexedDB content during merge', async () => {
      // User has local content
      const localContent = 'User local edits';
      doc.getText('content').insert(0, localContent);
      const localState = Y.encodeStateAsUpdate(doc);

      // Database has different content
      const dbDoc = new Y.Doc();
      dbDoc.getText('content').insert(0, 'Server content');
      const dbState = Y.encodeStateAsUpdate(dbDoc);
      const dbStateBase64 = btoa(String.fromCharCode(...dbState));

      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: [{
          id: 'main-document',
          yjs_state: dbStateBase64,
          updated_at: new Date().toISOString(),
        }],
        error: null,
      });

      await persistence.loadFromDatabase();

      // CRITICAL: Local content must still exist after merge
      const finalContent = doc.getText('content').toString();
      expect(finalContent).toContain('User local edits');

      // Should also have server content (CRDT merge)
      expect(finalContent).toContain('Server content');

      dbDoc.destroy();
    });

    it('CRITICAL: should handle corrupt database state without losing IndexedDB', async () => {
      const localContent = 'Safe local data';
      doc.getText('content').insert(0, localContent);

      // Database returns corrupt state
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: [{
          id: 'main-document',
          yjs_state: 'CORRUPT!!!NOT_BASE64!!!',
          updated_at: new Date().toISOString(),
        }],
        error: null,
      });

      // Should not throw and should preserve local
      await expect(persistence.loadFromDatabase()).resolves.not.toThrow();
      expect(doc.getText('content').toString()).toBe(localContent);
    });
  });

  describe('CRDT Merge Safety', () => {
    it('should merge concurrent edits without data loss', async () => {
      // Create two docs simulating two users
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();

      // User 1 types
      doc1.getText('content').insert(0, 'User 1 content ');
      const state1 = Y.encodeStateAsUpdate(doc1);

      // User 2 types (different location)
      doc2.getText('content').insert(0, 'User 2 content ');
      const state2 = Y.encodeStateAsUpdate(doc2);

      // Apply both updates to main doc
      Y.applyUpdate(doc, state1);
      Y.applyUpdate(doc, state2);

      const merged = doc.getText('content').toString();

      // Both edits must be preserved
      expect(merged).toContain('User 1 content');
      expect(merged).toContain('User 2 content');

      doc1.destroy();
      doc2.destroy();
    });

    it('should handle conflicting edits at same position', async () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();

      // Start with same base
      const baseText = 'Hello world';
      doc1.getText('content').insert(0, baseText);
      doc2.getText('content').insert(0, baseText);

      // Both users edit at position 6
      doc1.getText('content').delete(6, 5); // Delete "world"
      doc1.getText('content').insert(6, 'CRDT'); // Insert "CRDT"

      doc2.getText('content').delete(6, 5);
      doc2.getText('content').insert(6, 'merge'); // Insert "merge"

      // Get states
      const state1 = Y.encodeStateAsUpdate(doc1);
      const state2 = Y.encodeStateAsUpdate(doc2);

      // Apply to main doc
      Y.applyUpdate(doc, state1);
      Y.applyUpdate(doc, state2);

      // CRDT should deterministically resolve
      const result = doc.getText('content').toString();

      // At minimum, document should not be corrupted
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);

      // And base content should be there
      expect(result).toContain('Hello');

      doc1.destroy();
      doc2.destroy();
    });

    it('should preserve document after multiple merge cycles', async () => {
      const initialContent = 'Important content';
      doc.getText('content').insert(0, initialContent);

      // Simulate 10 merge cycles
      for (let i = 0; i < 10; i++) {
        const tempDoc = new Y.Doc();
        tempDoc.getText('content').insert(0, `Edit ${i} `);
        const update = Y.encodeStateAsUpdate(tempDoc);
        Y.applyUpdate(doc, update);
        tempDoc.destroy();
      }

      const final = doc.getText('content').toString();

      // Original content must still exist
      expect(final).toContain(initialContent);

      // All edits should be there
      for (let i = 0; i < 10; i++) {
        expect(final).toContain(`Edit ${i}`);
      }
    });
  });

  describe('Version Conflict Resolution', () => {
    it('should never overwrite newer local version with older server version', async () => {
      // User has recent local edits (version 10)
      const localContent = 'Latest local version 10';
      doc.getText('content').insert(0, localContent);

      // Server has old data (version 5)
      const oldDoc = new Y.Doc();
      oldDoc.getText('content').insert(0, 'Old server version 5');
      const oldState = Y.encodeStateAsUpdate(oldDoc);
      const oldStateBase64 = btoa(String.fromCharCode(...oldState));

      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: [{
          id: 'main-document',
          yjs_state: oldStateBase64,
          updated_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        }],
        error: null,
      });

      await persistence.loadFromDatabase();

      // CRITICAL: Newer local content must be preserved
      const final = doc.getText('content').toString();
      expect(final).toContain('Latest local version 10');

      oldDoc.destroy();
    });
  });

  describe('Network Failure Scenarios', () => {
    it('should handle timeout without losing local data', async () => {
      const localContent = 'Must survive timeout';
      doc.getText('content').insert(0, localContent);

      (supabase.rpc as jest.Mock).mockImplementation(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );

      await persistence.loadFromDatabase();

      expect(doc.getText('content').toString()).toBe(localContent);
    });

    it('should handle network offline without data loss', async () => {
      const localContent = 'Offline content';
      doc.getText('content').insert(0, localContent);

      (supabase.rpc as jest.Mock).mockRejectedValue({
        message: 'Network request failed',
        status: 0,
      });

      await persistence.loadFromDatabase();

      expect(doc.getText('content').toString()).toBe(localContent);
    });
  });
});
