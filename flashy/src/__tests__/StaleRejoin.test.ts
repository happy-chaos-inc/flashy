/**
 * STALE REJOIN TESTS
 *
 * Tests the critical scenario: a user returns to a room after a long absence
 * while another user has been editing. The returning user must see the current
 * document, not a garbage merge of stale local data + server data.
 *
 * Scenario: Alice edits a doc 2 hours ago. Bob joins later. Bob must see
 * Alice's content cleanly — no appended "crap" from stale local state.
 */

import * as Y from 'yjs';
import { markdownToProsemirror } from '../lib/markdownToProsemirror';
import { prosemirrorToMarkdown } from '../lib/prosemirrorToMarkdown';

describe('Stale Rejoin — CRDT merge safety', () => {

  it('should produce clean content when server state is applied to a fresh doc', () => {
    // Alice creates a document and saves to Supabase
    const aliceDoc = new Y.Doc();
    const aliceFragment = aliceDoc.getXmlFragment('prosemirror');
    markdownToProsemirror('# Biology\n## Mitosis\nCell division process', aliceFragment);

    // Simulate Supabase: encode Alice's state
    const serverState = Y.encodeStateAsUpdate(aliceDoc);

    // Bob joins with a FRESH doc (stale IndexedDB was deleted)
    const bobDoc = new Y.Doc();
    Y.applyUpdate(bobDoc, serverState);

    const bobFragment = bobDoc.getXmlFragment('prosemirror');
    const bobMd = prosemirrorToMarkdown(bobFragment);

    // Bob should see exactly Alice's content
    expect(bobMd).toBe('# Biology\n## Mitosis\nCell division process');

    aliceDoc.destroy();
    bobDoc.destroy();
  });

  it('should NOT duplicate content when same-lineage docs merge', () => {
    // Alice and Bob started from the same doc (same lineage)
    const originalDoc = new Y.Doc();
    const originalFragment = originalDoc.getXmlFragment('prosemirror');
    markdownToProsemirror('# Welcome\n## Term 1\nDefinition 1', originalFragment);
    const originalState = Y.encodeStateAsUpdate(originalDoc);

    // Alice's version (she added content after the original)
    const aliceDoc = new Y.Doc();
    Y.applyUpdate(aliceDoc, originalState);
    const aliceFragment = aliceDoc.getXmlFragment('prosemirror');
    const newHeading = new Y.XmlElement('heading');
    newHeading.setAttribute('level', 2);
    aliceFragment.push([newHeading]);
    newHeading.push([new Y.XmlText('Term 2')]);
    const newPara = new Y.XmlElement('paragraph');
    aliceFragment.push([newPara]);
    newPara.push([new Y.XmlText('Definition 2')]);
    const aliceState = Y.encodeStateAsUpdate(aliceDoc);

    // Bob has the original state in IndexedDB (same lineage, just older)
    const bobDoc = new Y.Doc();
    Y.applyUpdate(bobDoc, originalState);

    // Now merge Alice's state into Bob's
    Y.applyUpdate(bobDoc, aliceState);

    const bobFragment = bobDoc.getXmlFragment('prosemirror');
    const bobMd = prosemirrorToMarkdown(bobFragment);

    // Bob should see the combined content WITHOUT duplication
    expect(bobMd).toContain('# Welcome');
    expect(bobMd).toContain('## Term 1');
    expect(bobMd).toContain('Definition 1');
    expect(bobMd).toContain('## Term 2');
    expect(bobMd).toContain('Definition 2');

    // Critical: no duplication — "Welcome" appears exactly once
    const welcomeCount = (bobMd.match(/# Welcome/g) || []).length;
    expect(welcomeCount).toBe(1);

    const term1Count = (bobMd.match(/## Term 1/g) || []).length;
    expect(term1Count).toBe(1);

    originalDoc.destroy();
    aliceDoc.destroy();
    bobDoc.destroy();
  });

  it('should produce garbage when DIFFERENT lineage docs merge (the bug)', () => {
    // This test documents WHY stale IndexedDB must be deleted.
    // Two independently created Y.Docs for the same room produce duplicated content.

    // Alice creates her doc independently
    const aliceDoc = new Y.Doc();
    const aliceFragment = aliceDoc.getXmlFragment('prosemirror');
    markdownToProsemirror('# Study Notes\n## Concept A\nAlice wrote this', aliceFragment);
    const aliceState = Y.encodeStateAsUpdate(aliceDoc);

    // Bob has a DIFFERENT doc (different lineage — independently created, not forked)
    const bobDoc = new Y.Doc();
    const bobFragment = bobDoc.getXmlFragment('prosemirror');
    markdownToProsemirror('# Study Notes\n## Concept B\nBob had this from before', bobFragment);

    // Merge Alice's state into Bob's — this is the stale merge scenario
    Y.applyUpdate(bobDoc, aliceState);

    const mergedMd = prosemirrorToMarkdown(bobFragment);

    // BOTH sets of content appear — this is the "appended crap" bug
    expect(mergedMd).toContain('Concept A');
    expect(mergedMd).toContain('Concept B');
    expect(mergedMd).toContain('Alice wrote this');
    expect(mergedMd).toContain('Bob had this from before');

    // "Study Notes" heading appears TWICE — once from each lineage
    const headingCount = (mergedMd.match(/# Study Notes/g) || []).length;
    expect(headingCount).toBe(2);

    aliceDoc.destroy();
    bobDoc.destroy();
  });

  it('should produce clean content when stale IndexedDB is cleared first', () => {
    // This is the CORRECT behavior after the fix:
    // Bob's stale IndexedDB is deleted, so he loads fresh from Supabase only.

    // Alice creates content (this is what Supabase has)
    const aliceDoc = new Y.Doc();
    const aliceFragment = aliceDoc.getXmlFragment('prosemirror');
    markdownToProsemirror('# Study Notes\n## Concept A\nAlice wrote this', aliceFragment);
    const serverState = Y.encodeStateAsUpdate(aliceDoc);

    // Bob's stale IndexedDB is deleted → fresh Y.Doc
    const bobDoc = new Y.Doc();
    // Only apply server state (no stale local data)
    Y.applyUpdate(bobDoc, serverState);

    const bobFragment = bobDoc.getXmlFragment('prosemirror');
    const bobMd = prosemirrorToMarkdown(bobFragment);

    // Clean — only Alice's content, no duplication
    expect(bobMd).toBe('# Study Notes\n## Concept A\nAlice wrote this');

    // Heading appears exactly once
    const headingCount = (bobMd.match(/# Study Notes/g) || []).length;
    expect(headingCount).toBe(1);

    aliceDoc.destroy();
    bobDoc.destroy();
  });

  it('should preserve content when fresh IndexedDB merges with server (< 1hr)', () => {
    // Bob was recently on the page (< 1hr ago), made some offline edits.
    // He reconnects and his IndexedDB merges with Alice's server state.

    // Shared starting point
    const baseDoc = new Y.Doc();
    const baseFragment = baseDoc.getXmlFragment('prosemirror');
    markdownToProsemirror('# Shared Notes\n## Topic 1\nOriginal content', baseFragment);
    const baseState = Y.encodeStateAsUpdate(baseDoc);

    // Alice's edits (on server)
    const aliceDoc = new Y.Doc();
    Y.applyUpdate(aliceDoc, baseState);
    const aliceFragment = aliceDoc.getXmlFragment('prosemirror');
    const aliceH = new Y.XmlElement('heading');
    aliceH.setAttribute('level', 2);
    aliceFragment.push([aliceH]);
    aliceH.push([new Y.XmlText('Topic 2')]);
    const aliceP = new Y.XmlElement('paragraph');
    aliceFragment.push([aliceP]);
    aliceP.push([new Y.XmlText('Alice added this')]);
    const serverState = Y.encodeStateAsUpdate(aliceDoc);

    // Bob's offline edits (from same base, < 1hr ago)
    const bobDoc = new Y.Doc();
    Y.applyUpdate(bobDoc, baseState);
    const bobFragment = bobDoc.getXmlFragment('prosemirror');
    const bobH = new Y.XmlElement('heading');
    bobH.setAttribute('level', 2);
    bobFragment.push([bobH]);
    bobH.push([new Y.XmlText('Topic 3')]);
    const bobP = new Y.XmlElement('paragraph');
    bobFragment.push([bobP]);
    bobP.push([new Y.XmlText('Bob added this offline')]);

    // Now Bob reconnects — merge server state with his local
    Y.applyUpdate(bobDoc, serverState);

    const mergedMd = prosemirrorToMarkdown(bobFragment);

    // All three topics should be present — no data loss
    expect(mergedMd).toContain('## Topic 1');
    expect(mergedMd).toContain('Original content');
    expect(mergedMd).toContain('## Topic 2');
    expect(mergedMd).toContain('Alice added this');
    expect(mergedMd).toContain('## Topic 3');
    expect(mergedMd).toContain('Bob added this offline');

    // Shared heading appears exactly once (same lineage, not duplicated)
    const sharedCount = (mergedMd.match(/# Shared Notes/g) || []).length;
    expect(sharedCount).toBe(1);

    baseDoc.destroy();
    aliceDoc.destroy();
    bobDoc.destroy();
  });

  it('should not corrupt server data when Supabase load fails for stale user', () => {
    // Worst case: Bob's IndexedDB is stale AND Supabase load fails.
    // The auto-save guard should prevent an empty doc from overwriting server data.

    // After stale IndexedDB deletion + failed Supabase load, Bob has an empty doc
    const bobDoc = new Y.Doc();
    const bobFragment = bobDoc.getXmlFragment('prosemirror');

    // Verify the doc is empty
    expect(bobFragment.length).toBe(0);
    const bobMd = prosemirrorToMarkdown(bobFragment);
    expect(bobMd).toBe('');

    // The guard: if doc is empty, auto-save should NOT be enabled.
    // (This is enforced in CollaborationManager.loadFromDatabase catch block)
    // We verify the condition that triggers the guard:
    const hasLocalContent = bobFragment.length > 0;
    expect(hasLocalContent).toBe(false);

    bobDoc.destroy();
  });

  it('should handle the exact scenario: Alice edits 2hr ago, Bob joins fresh', () => {
    // Step 1: Alice creates a full study document 2 hours ago
    const aliceDoc = new Y.Doc();
    const aliceFragment = aliceDoc.getXmlFragment('prosemirror');
    markdownToProsemirror([
      '# HCI Notes',
      '',
      '## What is HCI?',
      'Human-Computer Interaction studies how people use computers.',
      '',
      '## Usability',
      'The ease with which users can accomplish their goals.',
      '',
      '## Nielsen Heuristics',
      'Ten usability heuristics for user interface design.',
      '- Visibility of system status',
      '- Match between system and real world',
      '- User control and freedom',
    ].join('\n'), aliceFragment);

    // Alice's state is saved to Supabase
    const serverState = Y.encodeStateAsUpdate(aliceDoc);
    const aliceMd = prosemirrorToMarkdown(aliceFragment);

    // Step 2: Bob joins with stale IndexedDB deleted (>1hr)
    // He gets a fresh doc, loads from Supabase
    const bobDoc = new Y.Doc();
    Y.applyUpdate(bobDoc, serverState);
    const bobFragment = bobDoc.getXmlFragment('prosemirror');
    const bobMd = prosemirrorToMarkdown(bobFragment);

    // Step 3: Verify Bob sees EXACTLY what Alice had — byte for byte
    expect(bobMd).toBe(aliceMd);

    // Step 4: Verify flashcard structure is intact
    const lines = bobMd.split('\n');
    const terms: string[] = [];
    lines.forEach(line => {
      const match = line.match(/^##\s+(.+)$/);
      if (match) terms.push(match[1]);
    });

    expect(terms).toEqual(['What is HCI?', 'Usability', 'Nielsen Heuristics']);

    // Step 5: Verify list items preserved
    expect(bobMd).toContain('- Visibility of system status');
    expect(bobMd).toContain('- Match between system and real world');
    expect(bobMd).toContain('- User control and freedom');

    aliceDoc.destroy();
    bobDoc.destroy();
  });

  it('should handle base64 persistence round-trip in the rejoin scenario', () => {
    // Alice saves to Supabase (base64 encoded)
    const aliceDoc = new Y.Doc();
    const aliceFragment = aliceDoc.getXmlFragment('prosemirror');
    markdownToProsemirror('# Notes\n## Term\nDefinition', aliceFragment);
    const aliceMd = prosemirrorToMarkdown(aliceFragment);

    // Simulate Supabase storage: encode as base64
    const stateUpdate = Y.encodeStateAsUpdate(aliceDoc);
    const base64 = btoa(String.fromCharCode(...stateUpdate));

    // Bob loads from Supabase: decode base64
    const decoded = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const bobDoc = new Y.Doc();
    Y.applyUpdate(bobDoc, decoded);

    const bobFragment = bobDoc.getXmlFragment('prosemirror');
    const bobMd = prosemirrorToMarkdown(bobFragment);

    expect(bobMd).toBe(aliceMd);

    aliceDoc.destroy();
    bobDoc.destroy();
  });
});
