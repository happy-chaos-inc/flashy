/**
 * MULTI-MODAL EDITING TESTS
 * Tests for Option 2: Rich AST as Canonical CRDT
 *
 * Tests the core functionality of editing the same document
 * in both Markdown and WYSIWYG modes with Y.XmlFragment as
 * the single source of truth.
 */

import * as Y from 'yjs';
import { markdownToProsemirror } from '../lib/markdownToProsemirror';
import { prosemirrorToMarkdown } from '../lib/prosemirrorToMarkdown';

describe('Multi-Modal Editing Tests', () => {
  describe('Markdown to ProseMirror Conversion', () => {
    it('should convert simple paragraphs', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const markdown = 'Hello world\nSecond paragraph';
      markdownToProsemirror(markdown, fragment);

      expect(fragment.length).toBe(2);
      expect(fragment.get(0).nodeName).toBe('paragraph');
      expect(fragment.get(1).nodeName).toBe('paragraph');

      doc.destroy();
    });

    it('should convert headings with levels', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const markdown = '# Heading 1\n## Heading 2\n### Heading 3';
      markdownToProsemirror(markdown, fragment);

      expect(fragment.length).toBe(3);
      expect(fragment.get(0).nodeName).toBe('heading');
      expect(fragment.get(0).getAttribute('level')).toBe('1');
      expect(fragment.get(1).getAttribute('level')).toBe('2');
      expect(fragment.get(2).getAttribute('level')).toBe('3');

      doc.destroy();
    });

    it('should convert bullet lists', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const markdown = '- Item 1\n- Item 2\n- Item 3';
      markdownToProsemirror(markdown, fragment);

      expect(fragment.length).toBe(3);
      expect(fragment.get(0).nodeName).toBe('bulletList');
      expect(fragment.get(1).nodeName).toBe('bulletList');
      expect(fragment.get(2).nodeName).toBe('bulletList');

      doc.destroy();
    });

    it('should convert ordered lists', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const markdown = '1. First\n2. Second\n3. Third';
      markdownToProsemirror(markdown, fragment);

      expect(fragment.length).toBe(3);
      expect(fragment.get(0).nodeName).toBe('orderedList');
      expect(fragment.get(1).nodeName).toBe('orderedList');
      expect(fragment.get(2).nodeName).toBe('orderedList');

      doc.destroy();
    });

    it('should convert code blocks', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const markdown = '```\nconst x = 1;\nconsole.log(x);\n```';
      markdownToProsemirror(markdown, fragment);

      expect(fragment.length).toBe(1);
      expect(fragment.get(0).nodeName).toBe('codeBlock');

      doc.destroy();
    });

    it('should preserve empty lines', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const markdown = 'Paragraph 1\n\nParagraph 2\n\n\nParagraph 3';
      markdownToProsemirror(markdown, fragment);

      // Should have: P1, empty, P2, empty, empty, P3
      expect(fragment.length).toBe(6);

      doc.destroy();
    });
  });

  describe('ProseMirror to Markdown Conversion', () => {
    it('should serialize paragraphs', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const p1 = new Y.XmlElement('paragraph');
      p1.push([new Y.XmlText('Hello')]);
      const p2 = new Y.XmlElement('paragraph');
      p2.push([new Y.XmlText('World')]);
      fragment.push([p1, p2]);

      const markdown = prosemirrorToMarkdown(fragment);
      expect(markdown).toBe('Hello\nWorld');

      doc.destroy();
    });

    it('should serialize headings', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const h1 = new Y.XmlElement('heading');
      h1.setAttribute('level', '1');
      h1.push([new Y.XmlText('Title')]);

      const h2 = new Y.XmlElement('heading');
      h2.setAttribute('level', '2');
      h2.push([new Y.XmlText('Subtitle')]);

      fragment.push([h1, h2]);

      const markdown = prosemirrorToMarkdown(fragment);
      expect(markdown).toBe('# Title\n## Subtitle');

      doc.destroy();
    });

    it('should serialize empty paragraphs', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const p1 = new Y.XmlElement('paragraph');
      p1.push([new Y.XmlText('First')]);

      const empty = new Y.XmlElement('paragraph');
      // Empty paragraph - no text

      const p2 = new Y.XmlElement('paragraph');
      p2.push([new Y.XmlText('Second')]);

      fragment.push([p1, empty, p2]);

      const markdown = prosemirrorToMarkdown(fragment);
      expect(markdown).toBe('First\n\nSecond');

      doc.destroy();
    });

    it('should serialize code blocks', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const code = new Y.XmlElement('codeBlock');
      code.push([new Y.XmlText('const x = 1;\nconsole.log(x);')]);
      fragment.push([code]);

      const markdown = prosemirrorToMarkdown(fragment);
      expect(markdown).toContain('```');
      expect(markdown).toContain('const x = 1;');

      doc.destroy();
    });
  });

  describe('Round-Trip Conversion', () => {
    it('should preserve simple text through round-trip', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const original = 'Hello world\nThis is a test';
      markdownToProsemirror(original, fragment);
      const result = prosemirrorToMarkdown(fragment);

      expect(result).toBe(original);

      doc.destroy();
    });

    it('should preserve headings through round-trip', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const original = '# Heading 1\n## Heading 2\nSome text';
      markdownToProsemirror(original, fragment);
      const result = prosemirrorToMarkdown(fragment);

      expect(result).toBe(original);

      doc.destroy();
    });

    it('should preserve empty lines through round-trip', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const original = 'First\n\nSecond\n\n\nThird';
      markdownToProsemirror(original, fragment);
      const result = prosemirrorToMarkdown(fragment);

      expect(result).toBe(original);

      doc.destroy();
    });

    it('should handle multiple round-trips without degradation', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const original = '# Test\n\nParagraph 1\n\nParagraph 2';

      // Round-trip 3 times
      markdownToProsemirror(original, fragment);
      const result1 = prosemirrorToMarkdown(fragment);

      fragment.delete(0, fragment.length);
      markdownToProsemirror(result1, fragment);
      const result2 = prosemirrorToMarkdown(fragment);

      fragment.delete(0, fragment.length);
      markdownToProsemirror(result2, fragment);
      const result3 = prosemirrorToMarkdown(fragment);

      expect(result1).toBe(original);
      expect(result2).toBe(original);
      expect(result3).toBe(original);

      doc.destroy();
    });
  });

  describe('Cross-Mode Collaboration', () => {
    it('should allow markdown user to see WYSIWYG changes', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      // WYSIWYG user creates content
      const heading = new Y.XmlElement('heading');
      heading.setAttribute('level', '1');
      heading.push([new Y.XmlText('Hello')]);
      fragment.push([heading]);

      // Markdown user reads it
      const markdown = prosemirrorToMarkdown(fragment);
      expect(markdown).toBe('# Hello');

      doc.destroy();
    });

    it('should allow WYSIWYG user to see markdown changes', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      // Markdown user creates content
      const markdown = '# Test\nSome text';
      markdownToProsemirror(markdown, fragment);

      // WYSIWYG user reads it
      expect(fragment.length).toBe(2);
      expect(fragment.get(0).nodeName).toBe('heading');
      expect(fragment.get(1).nodeName).toBe('paragraph');

      doc.destroy();
    });

    it('should maintain consistency across concurrent edits', () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();

      const fragment1 = doc1.getXmlFragment('content');
      const fragment2 = doc2.getXmlFragment('content');

      // User 1 (markdown) adds content
      markdownToProsemirror('# Title\nContent', fragment1);

      // Sync to user 2
      const update1 = Y.encodeStateAsUpdate(doc1);
      Y.applyUpdate(doc2, update1);

      // User 2 (WYSIWYG) adds content
      const newPara = new Y.XmlElement('paragraph');
      newPara.push([new Y.XmlText('More content')]);
      fragment2.push([newPara]);

      // Sync to user 1
      const update2 = Y.encodeStateAsUpdate(doc2);
      Y.applyUpdate(doc1, update2);

      // Both should have same structure
      expect(fragment1.length).toBe(fragment2.length);
      expect(fragment1.length).toBe(3); // heading + paragraph + paragraph

      // Both should serialize to same markdown
      const markdown1 = prosemirrorToMarkdown(fragment1);
      const markdown2 = prosemirrorToMarkdown(fragment2);
      expect(markdown1).toBe(markdown2);

      doc1.destroy();
      doc2.destroy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty document', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const markdown = prosemirrorToMarkdown(fragment);
      expect(markdown).toBe('');

      doc.destroy();
    });

    it('should handle only whitespace', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const markdown = '   \n\n   ';
      markdownToProsemirror(markdown, fragment);

      // Should create empty paragraphs
      expect(fragment.length).toBeGreaterThan(0);

      doc.destroy();
    });

    it('should handle special characters', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const markdown = '# Test & <Special> "Characters"\n@#$%^&*()';
      markdownToProsemirror(markdown, fragment);
      const result = prosemirrorToMarkdown(fragment);

      expect(result).toContain('&');
      expect(result).toContain('<Special>');
      expect(result).toContain('"Characters"');

      doc.destroy();
    });

    it('should handle very long content', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const longText = 'A'.repeat(10000);
      const markdown = `# Title\n${longText}`;

      markdownToProsemirror(markdown, fragment);
      const result = prosemirrorToMarkdown(fragment);

      expect(result).toContain('Title');
      expect(result.length).toBeGreaterThan(10000);

      doc.destroy();
    });

    it('should handle rapid sequential updates', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      // Simulate rapid markdown updates
      for (let i = 0; i < 10; i++) {
        fragment.delete(0, fragment.length);
        markdownToProsemirror(`# Version ${i}\nContent ${i}`, fragment);
      }

      const result = prosemirrorToMarkdown(fragment);
      expect(result).toBe('# Version 9\nContent 9');

      doc.destroy();
    });
  });

  describe('Flashcard Compatibility', () => {
    it('should parse flashcards from markdown format', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const markdown = '# Section\n## Term 1\nDefinition 1\n## Term 2\nDefinition 2';
      markdownToProsemirror(markdown, fragment);
      const result = prosemirrorToMarkdown(fragment);

      // Should preserve flashcard structure
      expect(result).toContain('# Section');
      expect(result).toContain('## Term 1');
      expect(result).toContain('Definition 1');

      doc.destroy();
    });

    it('should handle flashcards created in WYSIWYG', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      // Create flashcard structure in WYSIWYG
      const h1 = new Y.XmlElement('heading');
      h1.setAttribute('level', '1');
      h1.push([new Y.XmlText('Section')]);

      const h2 = new Y.XmlElement('heading');
      h2.setAttribute('level', '2');
      h2.push([new Y.XmlText('Term')]);

      const p = new Y.XmlElement('paragraph');
      p.push([new Y.XmlText('Definition')]);

      fragment.push([h1, h2, p]);

      // Serialize to markdown
      const markdown = prosemirrorToMarkdown(fragment);
      expect(markdown).toBe('# Section\n## Term\nDefinition');

      doc.destroy();
    });
  });

  describe('Performance', () => {
    it('should handle large documents efficiently', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      // Create 100 paragraphs
      const lines = Array(100)
        .fill(0)
        .map((_, i) => `Paragraph ${i}`)
        .join('\n');

      const start = performance.now();
      markdownToProsemirror(lines, fragment);
      const parseTime = performance.now() - start;

      const serializeStart = performance.now();
      prosemirrorToMarkdown(fragment);
      const serializeTime = performance.now() - serializeStart;

      // Should complete in reasonable time
      expect(parseTime).toBeLessThan(100); // 100ms
      expect(serializeTime).toBeLessThan(100); // 100ms

      doc.destroy();
    });

    it('should handle complex nested structures', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('test');

      const markdown = [
        '# Top Level',
        '',
        '## Second Level',
        '',
        'Some text',
        '',
        '- List item 1',
        '- List item 2',
        '',
        '```',
        'code here',
        '```',
        '',
        '### Third Level',
        '',
        'More text',
      ].join('\n');

      const start = performance.now();
      markdownToProsemirror(markdown, fragment);
      const result = prosemirrorToMarkdown(fragment);
      const totalTime = performance.now() - start;

      expect(totalTime).toBeLessThan(50); // 50ms
      expect(result).toContain('Top Level');
      expect(result).toContain('Second Level');

      doc.destroy();
    });
  });
});
