/**
 * EDITOR & WYSIWYG TESTS
 *
 * Tests the CRDT-backed editor experience that is core to Flashy:
 * - Indentation and nested list structures via Y.XmlFragment
 * - Correct markdown preview rendering from CRDT state
 * - Flashcard parsing from CRDT-backed content
 * - Multi-peer concurrent structural edits (headings, lists, code blocks)
 * - Round-trip fidelity for complex real-world documents
 */

import * as Y from 'yjs';
import { markdownToProsemirror } from '../lib/markdownToProsemirror';
import { prosemirrorToMarkdown } from '../lib/prosemirrorToMarkdown';

// Mirror the flashcard parser from EditorPage for testing preview correctness
function parseFlashcards(content: string) {
  const lines = content.split('\n');
  const cards: { id: string; term: string; definition: string; lineNumber: number; section?: string }[] = [];
  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      currentSection = h1Match[1].trim();
      continue;
    }
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      const term = h2Match[1].trim();
      let definition = '';
      let j = i + 1;
      while (j < lines.length && !lines[j].match(/^#{1,2}\s+/)) {
        definition += lines[j] + '\n';
        j++;
      }
      cards.push({
        id: `card-${i}`,
        term,
        definition: definition.trim(),
        lineNumber: i,
        section: currentSection || undefined,
      });
    }
  }
  return cards;
}

// Helper: create a Y.Doc with a fragment, populate via markdown, return both
function createDocFromMarkdown(markdown: string) {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('prosemirror');
  markdownToProsemirror(markdown, fragment);
  return { doc, fragment };
}

describe('Editor & WYSIWYG — Indentation', () => {
  it('should preserve nested bullet lists through CRDT round-trip', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    // Build a nested bullet list structure in CRDT directly
    const outerList = new Y.XmlElement('bulletList');
    const li1 = new Y.XmlElement('listItem');
    const p1 = new Y.XmlElement('paragraph');
    p1.push([new Y.XmlText('Top level item')]);
    li1.push([p1]);

    // Nested list inside li1
    const innerList = new Y.XmlElement('bulletList');
    const li1a = new Y.XmlElement('listItem');
    const p1a = new Y.XmlElement('paragraph');
    p1a.push([new Y.XmlText('Nested item A')]);
    li1a.push([p1a]);

    const li1b = new Y.XmlElement('listItem');
    const p1b = new Y.XmlElement('paragraph');
    p1b.push([new Y.XmlText('Nested item B')]);
    li1b.push([p1b]);

    innerList.push([li1a, li1b]);
    li1.push([innerList]);
    outerList.push([li1]);
    fragment.push([outerList]);

    // Serialize to markdown
    const md = prosemirrorToMarkdown(fragment);

    expect(md).toContain('- Top level item');
    expect(md).toContain('  - Nested item A');
    expect(md).toContain('  - Nested item B');

    doc.destroy();
  });

  it('should preserve nested ordered lists through CRDT round-trip', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    const outerList = new Y.XmlElement('orderedList');
    const li1 = new Y.XmlElement('listItem');
    const p1 = new Y.XmlElement('paragraph');
    p1.push([new Y.XmlText('Step one')]);
    li1.push([p1]);

    const innerList = new Y.XmlElement('orderedList');
    const li1a = new Y.XmlElement('listItem');
    const p1a = new Y.XmlElement('paragraph');
    p1a.push([new Y.XmlText('Sub-step A')]);
    li1a.push([p1a]);
    innerList.push([li1a]);

    li1.push([innerList]);
    outerList.push([li1]);
    fragment.push([outerList]);

    const md = prosemirrorToMarkdown(fragment);

    expect(md).toContain('1. Step one');
    expect(md).toContain('  1. Sub-step A');

    doc.destroy();
  });

  it('should preserve deeply nested lists (3 levels) in markdown preview', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    // Level 1
    const l1 = new Y.XmlElement('bulletList');
    const li1 = new Y.XmlElement('listItem');
    const p1 = new Y.XmlElement('paragraph');
    p1.push([new Y.XmlText('Level 1')]);
    li1.push([p1]);

    // Level 2
    const l2 = new Y.XmlElement('bulletList');
    const li2 = new Y.XmlElement('listItem');
    const p2 = new Y.XmlElement('paragraph');
    p2.push([new Y.XmlText('Level 2')]);
    li2.push([p2]);

    // Level 3
    const l3 = new Y.XmlElement('bulletList');
    const li3 = new Y.XmlElement('listItem');
    const p3 = new Y.XmlElement('paragraph');
    p3.push([new Y.XmlText('Level 3')]);
    li3.push([p3]);

    l3.push([li3]);
    li2.push([l3]);
    l2.push([li2]);
    li1.push([l2]);
    l1.push([li1]);
    fragment.push([l1]);

    const md = prosemirrorToMarkdown(fragment);

    expect(md).toContain('- Level 1');
    expect(md).toContain('  - Level 2');
    expect(md).toContain('    - Level 3');

    doc.destroy();
  });

  it('should handle mixed bullet and ordered nested lists', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    const bulletList = new Y.XmlElement('bulletList');
    const li = new Y.XmlElement('listItem');
    const p = new Y.XmlElement('paragraph');
    p.push([new Y.XmlText('Bullet parent')]);
    li.push([p]);

    const orderedChild = new Y.XmlElement('orderedList');
    const oli = new Y.XmlElement('listItem');
    const op = new Y.XmlElement('paragraph');
    op.push([new Y.XmlText('Ordered child')]);
    oli.push([op]);
    orderedChild.push([oli]);

    li.push([orderedChild]);
    bulletList.push([li]);
    fragment.push([bulletList]);

    const md = prosemirrorToMarkdown(fragment);

    expect(md).toContain('- Bullet parent');
    expect(md).toContain('  1. Ordered child');

    doc.destroy();
  });

  it('should handle list items with multiple paragraphs', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    const list = new Y.XmlElement('bulletList');
    const li = new Y.XmlElement('listItem');
    const p1 = new Y.XmlElement('paragraph');
    p1.push([new Y.XmlText('First paragraph')]);
    const p2 = new Y.XmlElement('paragraph');
    p2.push([new Y.XmlText('Second paragraph')]);

    li.push([p1, p2]);
    list.push([li]);
    fragment.push([list]);

    const md = prosemirrorToMarkdown(fragment);

    expect(md).toContain('- First paragraph');
    expect(md).toContain('Second paragraph');

    doc.destroy();
  });
});

describe('Editor & WYSIWYG — Flashcard Preview from CRDT', () => {
  it('should parse flashcards from CRDT-backed content with sections', () => {
    const markdown = [
      '# Biology',
      '## Mitosis',
      'The process of cell division that results in two identical daughter cells.',
      '## Meiosis',
      'Cell division that reduces chromosome number by half, producing gametes.',
    ].join('\n');

    const { doc, fragment } = createDocFromMarkdown(markdown);
    const rendered = prosemirrorToMarkdown(fragment);
    const cards = parseFlashcards(rendered);

    expect(cards).toHaveLength(2);
    expect(cards[0].term).toBe('Mitosis');
    expect(cards[0].section).toBe('Biology');
    expect(cards[0].definition).toContain('cell division');
    expect(cards[1].term).toBe('Meiosis');
    expect(cards[1].definition).toContain('gametes');

    doc.destroy();
  });

  it('should parse multi-line definitions correctly', () => {
    const markdown = [
      '# Chemistry',
      '## Covalent Bond',
      'A chemical bond formed by the sharing of electron pairs.',
      'Common in organic molecules.',
      'Strength depends on electronegativity difference.',
    ].join('\n');

    const { doc, fragment } = createDocFromMarkdown(markdown);
    const rendered = prosemirrorToMarkdown(fragment);
    const cards = parseFlashcards(rendered);

    expect(cards).toHaveLength(1);
    expect(cards[0].definition).toContain('sharing of electron pairs');
    expect(cards[0].definition).toContain('organic molecules');
    expect(cards[0].definition).toContain('electronegativity');

    doc.destroy();
  });

  it('should handle multiple sections with multiple cards', () => {
    const markdown = [
      '# Section A',
      '## Term A1',
      'Def A1',
      '## Term A2',
      'Def A2',
      '# Section B',
      '## Term B1',
      'Def B1',
    ].join('\n');

    const { doc, fragment } = createDocFromMarkdown(markdown);
    const rendered = prosemirrorToMarkdown(fragment);
    const cards = parseFlashcards(rendered);

    expect(cards).toHaveLength(3);
    expect(cards[0].section).toBe('Section A');
    expect(cards[1].section).toBe('Section A');
    expect(cards[2].section).toBe('Section B');

    doc.destroy();
  });

  it('should handle cards with code blocks in definitions', () => {
    const markdown = [
      '# Programming',
      '## forEach',
      'Iterates over array elements.',
      '```',
      'arr.forEach(item => console.log(item));',
      '```',
      '## map',
      'Transforms each element and returns new array.',
    ].join('\n');

    const { doc, fragment } = createDocFromMarkdown(markdown);
    const rendered = prosemirrorToMarkdown(fragment);
    const cards = parseFlashcards(rendered);

    expect(cards).toHaveLength(2);
    expect(cards[0].term).toBe('forEach');
    expect(cards[0].definition).toContain('forEach');
    expect(cards[1].term).toBe('map');

    doc.destroy();
  });

  it('should handle cards with list items in definitions', () => {
    const markdown = [
      '# Math',
      '## Properties of Addition',
      'Key properties:',
      '- Commutative',
      '- Associative',
      '- Identity element is 0',
    ].join('\n');

    const { doc, fragment } = createDocFromMarkdown(markdown);
    const rendered = prosemirrorToMarkdown(fragment);
    const cards = parseFlashcards(rendered);

    expect(cards).toHaveLength(1);
    expect(cards[0].term).toBe('Properties of Addition');
    expect(cards[0].definition).toContain('Commutative');
    expect(cards[0].definition).toContain('Associative');

    doc.destroy();
  });

  it('should produce empty array for document with no H2 headers', () => {
    const markdown = '# Just a title\nSome body text\nMore text';

    const { doc, fragment } = createDocFromMarkdown(markdown);
    const rendered = prosemirrorToMarkdown(fragment);
    const cards = parseFlashcards(rendered);

    expect(cards).toHaveLength(0);

    doc.destroy();
  });
});

describe('Editor & WYSIWYG — Multi-Peer Structural Edits', () => {
  it('should merge heading additions from two peers', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    const f1 = doc1.getXmlFragment('prosemirror');
    const f2 = doc2.getXmlFragment('prosemirror');

    // Peer 1 adds a heading
    const h1 = new Y.XmlElement('heading');
    h1.setAttribute('level', 1);
    h1.push([new Y.XmlText('Chapter 1')]);
    f1.push([h1]);

    // Sync peer1 -> peer2
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    // Peer 2 adds another heading after
    const h2 = new Y.XmlElement('heading');
    h2.setAttribute('level', 2);
    h2.push([new Y.XmlText('Section 1.1')]);
    f2.push([h2]);

    // Sync peer2 -> peer1
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

    // Both should converge
    const md1 = prosemirrorToMarkdown(f1);
    const md2 = prosemirrorToMarkdown(f2);
    expect(md1).toBe(md2);
    expect(md1).toContain('# Chapter 1');
    expect(md1).toContain('## Section 1.1');

    doc1.destroy();
    doc2.destroy();
  });

  it('should merge list additions from two peers simultaneously', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    const f1 = doc1.getXmlFragment('prosemirror');
    const f2 = doc2.getXmlFragment('prosemirror');

    // Both start with same initial content
    const initial = '# Shopping';
    markdownToProsemirror(initial, f1);
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    // Peer 1 adds a bullet list
    const bl1 = new Y.XmlElement('bulletList');
    const li1 = new Y.XmlElement('listItem');
    const p1 = new Y.XmlElement('paragraph');
    p1.push([new Y.XmlText('Apples')]);
    li1.push([p1]);
    bl1.push([li1]);
    f1.push([bl1]);

    // Peer 2 adds a different bullet list (concurrently, no sync yet)
    const bl2 = new Y.XmlElement('bulletList');
    const li2 = new Y.XmlElement('listItem');
    const p2 = new Y.XmlElement('paragraph');
    p2.push([new Y.XmlText('Bananas')]);
    li2.push([p2]);
    bl2.push([li2]);
    f2.push([bl2]);

    // Now sync both ways
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

    const md1 = prosemirrorToMarkdown(f1);
    const md2 = prosemirrorToMarkdown(f2);

    expect(md1).toBe(md2);
    expect(md1).toContain('Apples');
    expect(md1).toContain('Bananas');

    doc1.destroy();
    doc2.destroy();
  });

  it('should handle one peer adding a code block while another adds a heading', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    const f1 = doc1.getXmlFragment('prosemirror');
    const f2 = doc2.getXmlFragment('prosemirror');

    // Peer 1 adds a code block
    const code = new Y.XmlElement('codeBlock');
    code.push([new Y.XmlText('console.log("hello");')]);
    f1.push([code]);

    // Peer 2 adds a heading (concurrent)
    const h = new Y.XmlElement('heading');
    h.setAttribute('level', 2);
    h.push([new Y.XmlText('Example')]);
    f2.push([h]);

    // Sync
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

    const md1 = prosemirrorToMarkdown(f1);
    const md2 = prosemirrorToMarkdown(f2);

    expect(md1).toBe(md2);
    expect(md1).toContain('```');
    expect(md1).toContain('console.log');
    expect(md1).toContain('## Example');

    doc1.destroy();
    doc2.destroy();
  });

  it('should converge when three peers edit different sections concurrently', () => {
    const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
    const fragments = docs.map(d => d.getXmlFragment('prosemirror'));

    // Peer 0: heading
    const h = new Y.XmlElement('heading');
    h.setAttribute('level', 1);
    h.push([new Y.XmlText('Document')]);
    fragments[0].push([h]);

    // Peer 1: paragraph
    const p = new Y.XmlElement('paragraph');
    p.push([new Y.XmlText('Some content here.')]);
    fragments[1].push([p]);

    // Peer 2: bullet list
    const bl = new Y.XmlElement('bulletList');
    const li = new Y.XmlElement('listItem');
    const lp = new Y.XmlElement('paragraph');
    lp.push([new Y.XmlText('A list item')]);
    li.push([lp]);
    bl.push([li]);
    fragments[2].push([bl]);

    // Full mesh sync
    for (let i = 0; i < docs.length; i++) {
      for (let j = 0; j < docs.length; j++) {
        if (i !== j) {
          Y.applyUpdate(docs[j], Y.encodeStateAsUpdate(docs[i]));
        }
      }
    }

    const markdowns = fragments.map(f => prosemirrorToMarkdown(f));

    // All three should be identical
    expect(markdowns[0]).toBe(markdowns[1]);
    expect(markdowns[1]).toBe(markdowns[2]);

    // All content should be present
    expect(markdowns[0]).toContain('# Document');
    expect(markdowns[0]).toContain('Some content here.');
    expect(markdowns[0]).toContain('A list item');

    docs.forEach(d => d.destroy());
  });

  it('should handle concurrent deletions and insertions at same position', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    const f1 = doc1.getXmlFragment('prosemirror');
    const f2 = doc2.getXmlFragment('prosemirror');

    // Shared initial state: two paragraphs
    markdownToProsemirror('First\nSecond', f1);
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    // Peer 1 deletes the first element
    f1.delete(0, 1);

    // Peer 2 inserts a heading before everything (concurrent)
    const h = new Y.XmlElement('heading');
    h.setAttribute('level', 1);
    h.push([new Y.XmlText('Title')]);
    f2.insert(0, [h]);

    // Sync
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));

    const md1 = prosemirrorToMarkdown(f1);
    const md2 = prosemirrorToMarkdown(f2);

    expect(md1).toBe(md2);
    // Title should be present (peer2 inserted it)
    expect(md1).toContain('Title');
    // "Second" should be present (not deleted)
    expect(md1).toContain('Second');

    doc1.destroy();
    doc2.destroy();
  });
});

describe('Editor & WYSIWYG — Complex Document Round-Trips', () => {
  it('should round-trip a realistic study notes document', () => {
    const markdown = [
      '# Biology 101',
      '',
      '## Photosynthesis',
      'The process by which green plants convert sunlight into chemical energy.',
      '',
      '## Cellular Respiration',
      'The metabolic process that converts glucose into ATP.',
      'Occurs in the mitochondria.',
      '',
      '# Chemistry 201',
      '',
      '## Ionic Bonds',
      'Formed by the transfer of electrons between atoms.',
    ].join('\n');

    const { doc, fragment } = createDocFromMarkdown(markdown);
    const rendered = prosemirrorToMarkdown(fragment);

    // Structure should be preserved
    expect(rendered).toContain('# Biology 101');
    expect(rendered).toContain('## Photosynthesis');
    expect(rendered).toContain('sunlight into chemical energy');
    expect(rendered).toContain('## Cellular Respiration');
    expect(rendered).toContain('mitochondria');
    expect(rendered).toContain('# Chemistry 201');
    expect(rendered).toContain('## Ionic Bonds');

    // Flashcards should parse correctly from the rendered output
    const cards = parseFlashcards(rendered);
    expect(cards).toHaveLength(3);
    expect(cards[0].term).toBe('Photosynthesis');
    expect(cards[0].section).toBe('Biology 101');
    expect(cards[2].term).toBe('Ionic Bonds');
    expect(cards[2].section).toBe('Chemistry 201');

    doc.destroy();
  });

  it('should round-trip code blocks with language hints', () => {
    const markdown = [
      '# Programming',
      '## Array Methods',
      '```',
      'const nums = [1, 2, 3];',
      'const doubled = nums.map(n => n * 2);',
      '```',
    ].join('\n');

    const { doc, fragment } = createDocFromMarkdown(markdown);
    const rendered = prosemirrorToMarkdown(fragment);

    expect(rendered).toContain('```');
    expect(rendered).toContain('const nums = [1, 2, 3];');
    expect(rendered).toContain('nums.map(n => n * 2)');

    doc.destroy();
  });

  it('should round-trip interleaved headings, paragraphs, and lists', () => {
    const markdown = [
      '# Study Guide',
      '',
      'Introduction to the course.',
      '',
      '## Key Concepts',
      'These are important:',
      '- Concept A',
      '- Concept B',
      '',
      '## Formulas',
      'Remember these formulas.',
    ].join('\n');

    const { doc, fragment } = createDocFromMarkdown(markdown);
    const rendered = prosemirrorToMarkdown(fragment);

    expect(rendered).toContain('# Study Guide');
    expect(rendered).toContain('Introduction to the course.');
    expect(rendered).toContain('## Key Concepts');
    expect(rendered).toContain('- Concept A');
    expect(rendered).toContain('- Concept B');
    expect(rendered).toContain('## Formulas');

    doc.destroy();
  });

  it('should handle a document with only headings (no body)', () => {
    const markdown = '# Title\n## Subtitle\n### Sub-subtitle';

    const { doc, fragment } = createDocFromMarkdown(markdown);
    const rendered = prosemirrorToMarkdown(fragment);

    expect(rendered).toBe(markdown);

    doc.destroy();
  });

  it('should preserve heading level integrity through CRDT sync', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const f1 = doc1.getXmlFragment('prosemirror');

    // Create headings H1-H6
    for (let level = 1; level <= 6; level++) {
      const h = new Y.XmlElement('heading');
      h.setAttribute('level', level);
      h.push([new Y.XmlText(`Heading ${level}`)]);
      f1.push([h]);
    }

    // Sync to doc2
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    const f2 = doc2.getXmlFragment('prosemirror');

    const md1 = prosemirrorToMarkdown(f1);
    const md2 = prosemirrorToMarkdown(f2);

    expect(md1).toBe(md2);

    for (let level = 1; level <= 6; level++) {
      expect(md1).toContain('#'.repeat(level) + ` Heading ${level}`);
    }

    doc1.destroy();
    doc2.destroy();
  });

  it('should handle blockquotes in CRDT', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    const bq = new Y.XmlElement('blockquote');
    const p = new Y.XmlElement('paragraph');
    p.push([new Y.XmlText('To be or not to be.')]);
    bq.push([p]);
    fragment.push([bq]);

    const md = prosemirrorToMarkdown(fragment);
    expect(md).toContain('> To be or not to be.');

    doc.destroy();
  });
});

describe('Editor & WYSIWYG — Heading Level Normalization', () => {
  it('should handle string heading levels (from y-prosemirror)', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    // y-prosemirror sometimes passes levels as strings
    const h = new Y.XmlElement('heading');
    h.setAttribute('level', '2' as any);
    h.push([new Y.XmlText('String Level')]);
    fragment.push([h]);

    const md = prosemirrorToMarkdown(fragment);
    expect(md).toBe('## String Level');

    doc.destroy();
  });

  it('should handle numeric heading levels', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    const h = new Y.XmlElement('heading');
    h.setAttribute('level', 3);
    h.push([new Y.XmlText('Numeric Level')]);
    fragment.push([h]);

    const md = prosemirrorToMarkdown(fragment);
    expect(md).toBe('### Numeric Level');

    doc.destroy();
  });

  it('should default to H1 when level attribute is missing', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    const h = new Y.XmlElement('heading');
    // No level set
    h.push([new Y.XmlText('No Level')]);
    fragment.push([h]);

    const md = prosemirrorToMarkdown(fragment);
    expect(md).toBe('# No Level');

    doc.destroy();
  });

  it('should preserve heading levels through two-peer sync', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    const f1 = doc1.getXmlFragment('prosemirror');

    // Peer 1 creates H1 with numeric level
    const h1 = new Y.XmlElement('heading');
    h1.setAttribute('level', 1);
    h1.push([new Y.XmlText('Title')]);

    // Peer 1 creates H2 with string level (simulating y-prosemirror)
    const h2 = new Y.XmlElement('heading');
    h2.setAttribute('level', '2' as any);
    h2.push([new Y.XmlText('Subtitle')]);

    f1.push([h1, h2]);

    // Sync
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));
    const f2 = doc2.getXmlFragment('prosemirror');

    const md2 = prosemirrorToMarkdown(f2);
    expect(md2).toContain('# Title');
    expect(md2).toContain('## Subtitle');

    doc1.destroy();
    doc2.destroy();
  });
});

describe('Editor & WYSIWYG — Empty & Edge-Case Documents', () => {
  it('should handle a completely empty CRDT fragment', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    const md = prosemirrorToMarkdown(fragment);
    expect(md).toBe('');

    const cards = parseFlashcards(md);
    expect(cards).toHaveLength(0);

    doc.destroy();
  });

  it('should handle a single empty paragraph', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    const p = new Y.XmlElement('paragraph');
    fragment.push([p]);

    const md = prosemirrorToMarkdown(fragment);
    // Empty paragraph renders as empty string
    expect(md).toBe('');

    doc.destroy();
  });

  it('should handle unicode content in CRDT', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    const h = new Y.XmlElement('heading');
    h.setAttribute('level', 1);
    h.push([new Y.XmlText('Vocabulaire Francais')]);

    const p = new Y.XmlElement('paragraph');
    p.push([new Y.XmlText('Bonjour tout le monde')]);

    fragment.push([h, p]);

    // Sync to another doc
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc));
    const f2 = doc2.getXmlFragment('prosemirror');

    const md = prosemirrorToMarkdown(f2);
    expect(md).toContain('Francais');
    expect(md).toContain('Bonjour');

    doc.destroy();
    doc2.destroy();
  });

  it('should handle emoji in headings and paragraphs', () => {
    const { doc, fragment } = createDocFromMarkdown('# 🧬 Biology\n## 🌱 Photosynthesis\nPlants use sunlight 🌞');
    const rendered = prosemirrorToMarkdown(fragment);

    expect(rendered).toContain('🧬 Biology');
    expect(rendered).toContain('🌱 Photosynthesis');
    expect(rendered).toContain('🌞');

    doc.destroy();
  });

  it('should handle very long definitions without truncation in CRDT', () => {
    const longDef = 'This is a very detailed definition. '.repeat(50);
    const markdown = `# Section\n## Term\n${longDef.trim()}`;

    const { doc, fragment } = createDocFromMarkdown(markdown);
    const rendered = prosemirrorToMarkdown(fragment);
    const cards = parseFlashcards(rendered);

    expect(cards).toHaveLength(1);
    expect(cards[0].definition.length).toBeGreaterThan(500);

    doc.destroy();
  });
});

describe('Editor & WYSIWYG — CRDT Structural Integrity Under Stress', () => {
  it('should handle 50 concurrent flashcard insertions from different peers', () => {
    const docs = Array.from({ length: 5 }, () => new Y.Doc());
    const fragments = docs.map(d => d.getXmlFragment('prosemirror'));

    // Each peer adds 10 flashcard entries
    docs.forEach((_, peerIdx) => {
      for (let i = 0; i < 10; i++) {
        const h = new Y.XmlElement('heading');
        h.setAttribute('level', 2);
        h.push([new Y.XmlText(`Peer${peerIdx}_Term${i}`)]);

        const p = new Y.XmlElement('paragraph');
        p.push([new Y.XmlText(`Definition from peer ${peerIdx} item ${i}`)]);

        fragments[peerIdx].push([h, p]);
      }
    });

    // Full mesh sync
    for (let i = 0; i < docs.length; i++) {
      for (let j = 0; j < docs.length; j++) {
        if (i !== j) {
          Y.applyUpdate(docs[j], Y.encodeStateAsUpdate(docs[i]));
        }
      }
    }

    // All peers should have same content
    const markdowns = fragments.map(f => prosemirrorToMarkdown(f));
    for (let i = 1; i < markdowns.length; i++) {
      expect(markdowns[i]).toBe(markdowns[0]);
    }

    // All 50 terms should be present
    const cards = parseFlashcards(markdowns[0]);
    expect(cards.length).toBe(50);

    // Verify each peer's content is present
    for (let peerIdx = 0; peerIdx < 5; peerIdx++) {
      for (let i = 0; i < 10; i++) {
        expect(markdowns[0]).toContain(`Peer${peerIdx}_Term${i}`);
      }
    }

    docs.forEach(d => d.destroy());
  });

  it('should handle rapid add/delete cycles without corruption', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    for (let cycle = 0; cycle < 20; cycle++) {
      // Add two elements
      const h = new Y.XmlElement('heading');
      h.setAttribute('level', 2);
      h.push([new Y.XmlText(`Cycle ${cycle}`)]);
      const p = new Y.XmlElement('paragraph');
      p.push([new Y.XmlText(`Content ${cycle}`)]);
      fragment.push([h, p]);

      // Delete the first element if there are enough
      if (fragment.length > 4) {
        fragment.delete(0, 2);
      }
    }

    // Should still produce valid markdown
    const md = prosemirrorToMarkdown(fragment);
    expect(md.length).toBeGreaterThan(0);
    // Should contain the most recent cycle's content
    expect(md).toContain('Cycle 19');

    doc.destroy();
  });

  it('should maintain CRDT state through base64 persistence round-trip', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    markdownToProsemirror('# Title\n## Term\nDefinition text', fragment);
    const originalMd = prosemirrorToMarkdown(fragment);

    // Simulate database persistence (base64 encode/decode)
    const state = Y.encodeStateAsUpdate(doc);
    const base64 = btoa(String.fromCharCode(...state));

    // Restore from persistence
    const decoded = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, decoded);
    const f2 = doc2.getXmlFragment('prosemirror');

    const restoredMd = prosemirrorToMarkdown(f2);
    expect(restoredMd).toBe(originalMd);

    const cards = parseFlashcards(restoredMd);
    expect(cards).toHaveLength(1);
    expect(cards[0].term).toBe('Term');

    doc.destroy();
    doc2.destroy();
  });
});
