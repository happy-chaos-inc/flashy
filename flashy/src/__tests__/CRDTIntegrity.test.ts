/**
 * CRDT INTEGRITY TESTS
 * Rigorous testing of CRDT operations to ensure data consistency
 */

import * as Y from 'yjs';

describe('CRDT Integrity Tests', () => {
  describe('Yjs CRDT Guarantees', () => {
    it('should maintain eventual consistency', () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();
      const doc3 = new Y.Doc();

      // Three users make different edits
      doc1.getText('content').insert(0, 'User 1 ');
      doc2.getText('content').insert(0, 'User 2 ');
      doc3.getText('content').insert(0, 'User 3 ');

      // Get all updates
      const update1 = Y.encodeStateAsUpdate(doc1);
      const update2 = Y.encodeStateAsUpdate(doc2);
      const update3 = Y.encodeStateAsUpdate(doc3);

      // Apply in different orders to different docs
      const docA = new Y.Doc();
      Y.applyUpdate(docA, update1);
      Y.applyUpdate(docA, update2);
      Y.applyUpdate(docA, update3);

      const docB = new Y.Doc();
      Y.applyUpdate(docB, update3);
      Y.applyUpdate(docB, update1);
      Y.applyUpdate(docB, update2);

      const docC = new Y.Doc();
      Y.applyUpdate(docC, update2);
      Y.applyUpdate(docC, update3);
      Y.applyUpdate(docC, update1);

      // All docs should converge to same state
      expect(docA.getText('content').toString()).toBe(
        docB.getText('content').toString()
      );
      expect(docB.getText('content').toString()).toBe(
        docC.getText('content').toString()
      );

      // Cleanup
      [doc1, doc2, doc3, docA, docB, docC].forEach(d => d.destroy());
    });

    it('should handle insert operations correctly', () => {
      const doc = new Y.Doc();
      const text = doc.getText('content');

      text.insert(0, 'Hello');
      expect(text.toString()).toBe('Hello');

      text.insert(5, ' World');
      expect(text.toString()).toBe('Hello World');

      text.insert(5, ' Beautiful');
      expect(text.toString()).toBe('Hello Beautiful World');

      doc.destroy();
    });

    it('should handle delete operations correctly', () => {
      const doc = new Y.Doc();
      const text = doc.getText('content');

      text.insert(0, 'Hello Beautiful World');
      text.delete(5, 10); // Delete " Beautiful"

      expect(text.toString()).toBe('Hello World');

      doc.destroy();
    });

    it('should handle rapid concurrent edits', () => {
      const mainDoc = new Y.Doc();
      const docs = Array.from({ length: 5 }, () => new Y.Doc());

      // Simulate 5 users typing simultaneously
      docs.forEach((doc, i) => {
        doc.getText('content').insert(0, `User${i} `);
      });

      // Apply all updates to main doc
      docs.forEach(doc => {
        const update = Y.encodeStateAsUpdate(doc);
        Y.applyUpdate(mainDoc, update);
      });

      const result = mainDoc.getText('content').toString();

      // All user content should be present
      docs.forEach((_, i) => {
        expect(result).toContain(`User${i}`);
      });

      [mainDoc, ...docs].forEach(d => d.destroy());
    });

    it('should preserve insertion order within same document', () => {
      const doc = new Y.Doc();
      const text = doc.getText('content');

      // Sequential inserts
      text.insert(0, 'A');
      text.insert(1, 'B');
      text.insert(2, 'C');
      text.insert(3, 'D');
      text.insert(4, 'E');

      expect(text.toString()).toBe('ABCDE');

      doc.destroy();
    });

    it('should handle empty document merges', () => {
      const doc1 = new Y.Doc(); // Empty
      const doc2 = new Y.Doc();
      doc2.getText('content').insert(0, 'Content');

      const update = Y.encodeStateAsUpdate(doc2);
      Y.applyUpdate(doc1, update);

      expect(doc1.getText('content').toString()).toBe('Content');

      doc1.destroy();
      doc2.destroy();
    });

    it('should handle merging same content multiple times (idempotent)', () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();

      doc2.getText('content').insert(0, 'Test');
      const update = Y.encodeStateAsUpdate(doc2);

      // Apply same update multiple times
      Y.applyUpdate(doc1, update);
      Y.applyUpdate(doc1, update);
      Y.applyUpdate(doc1, update);

      // Should only have content once
      expect(doc1.getText('content').toString()).toBe('Test');

      doc1.destroy();
      doc2.destroy();
    });

    it('should handle complex editing scenarios', () => {
      const doc = new Y.Doc();
      const text = doc.getText('content');

      // Complex sequence of operations
      text.insert(0, 'The quick brown fox');
      expect(text.toString()).toBe('The quick brown fox');

      text.insert(10, 'red '); // Insert "red " at position 10 -> "The quick red brown fox"
      expect(text.toString()).toBe('The quick red brown fox');

      text.delete(14, 6); // Delete "brown " at position 14 -> "The quick red fox"
      expect(text.toString()).toBe('The quick red fox');

      text.insert(14, 'sly '); // Insert "sly " at position 14 -> "The quick red sly fox"
      expect(text.toString()).toBe('The quick red sly fox');

      text.insert(text.length, ' jumps'); // Append " jumps" at end
      expect(text.toString()).toBe('The quick red sly fox jumps');

      doc.destroy();
    });
  });

  describe('State Vector Encoding/Decoding', () => {
    it('should correctly encode and decode state', () => {
      const doc1 = new Y.Doc();
      doc1.getText('content').insert(0, 'Original content');

      // Encode state
      const state = Y.encodeStateAsUpdate(doc1);

      // Decode into new doc
      const doc2 = new Y.Doc();
      Y.applyUpdate(doc2, state);

      expect(doc2.getText('content').toString()).toBe('Original content');

      doc1.destroy();
      doc2.destroy();
    });

    it('should handle base64 encoding for database storage', () => {
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'Test content for base64');

      const state = Y.encodeStateAsUpdate(doc);
      const base64 = btoa(String.fromCharCode(...state));

      // Decode base64
      const decoded = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

      const doc2 = new Y.Doc();
      Y.applyUpdate(doc2, decoded);

      expect(doc2.getText('content').toString()).toBe('Test content for base64');

      doc.destroy();
      doc2.destroy();
    });

    it('should preserve unicode characters in encoding', () => {
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

    it('should handle large documents', () => {
      const doc = new Y.Doc();
      const largeText = 'Lorem ipsum '.repeat(10000); // ~120KB of text

      doc.getText('content').insert(0, largeText);
      const state = Y.encodeStateAsUpdate(doc);

      const doc2 = new Y.Doc();
      Y.applyUpdate(doc2, state);

      expect(doc2.getText('content').toString()).toBe(largeText);
      expect(doc2.getText('content').length).toBe(largeText.length);

      doc.destroy();
      doc2.destroy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty state updates', () => {
      const doc = new Y.Doc();
      const emptyUpdate = Y.encodeStateAsUpdate(doc);

      const doc2 = new Y.Doc();
      Y.applyUpdate(doc2, emptyUpdate);

      expect(doc2.getText('content').toString()).toBe('');

      doc.destroy();
      doc2.destroy();
    });

    it('should handle deleting from empty document', () => {
      const doc = new Y.Doc();
      const text = doc.getText('content');

      // Deleting from empty should be no-op (nothing to delete)
      text.delete(0, 0); // Delete 0 characters is safe
      expect(text.toString()).toBe('');

      doc.destroy();
    });

    it('should handle inserting at invalid position', () => {
      const doc = new Y.Doc();
      const text = doc.getText('content');

      text.insert(0, 'Hello');

      // Insert beyond length should append
      text.insert(100, ' World');

      expect(text.toString()).toContain('Hello');
      expect(text.toString()).toContain('World');

      doc.destroy();
    });
  });
});
