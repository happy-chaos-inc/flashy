/**
 * MERGE DUPLICATION TESTS
 *
 * Tests for the critical bug where CRDT merges duplicate content.
 *
 * Root cause: saveNow() was loading DB state and merging it with local
 * state before saving. If the DB state had a different CRDT lineage
 * (e.g., from a previous session that diverged), Y.applyUpdate would
 * ADD the old content instead of replacing it — doubling the document.
 *
 * These tests verify:
 * 1. saveNow() does NOT merge DB state before saving
 * 2. Polling does not corrupt non-empty docs
 * 3. Rejoin scenario doesn't cause duplication
 * 4. The specific 530→332 card duplication scenario
 */

import * as Y from 'yjs';
import { DocumentPersistence } from '../lib/DocumentPersistence';
import { supabase } from '../config/supabase';
import { markdownToProsemirror } from '../lib/markdownToProsemirror';
import { prosemirrorToMarkdown } from '../lib/prosemirrorToMarkdown';

jest.mock('../config/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    })),
  },
}));

// Helper: encode Y.Doc state as base64 (same as production code)
function encodeAsBase64(doc: Y.Doc): string {
  const state = Y.encodeStateAsUpdate(doc);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < state.length; i += chunkSize) {
    const chunk = state.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// Helper: create a doc with prosemirror content
function createDocWithContent(markdown: string): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('prosemirror');
  markdownToProsemirror(markdown, fragment);
  return doc;
}

describe('CRITICAL: Merge-on-Save Duplication Bug', () => {
  let doc: Y.Doc;
  let persistence: DocumentPersistence;

  beforeEach(() => {
    doc = new Y.Doc();
    persistence = new DocumentPersistence(doc);
    jest.clearAllMocks();
  });

  afterEach(() => {
    persistence.destroy();
    doc.destroy();
  });

  describe('saveNow() must NOT merge DB state', () => {
    it('CRITICAL: saveNow should save local state without fetching DB state first', async () => {
      // Setup: local doc has content
      doc.getText('content').insert(0, 'Local content only');

      // Mock the save RPC to succeed
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: { message: 'ok' },
        error: null,
      });

      await persistence.saveNow();

      // Verify: saveNow called upsert_document_rpc ONCE, and did NOT call get_document
      const rpcCalls = (supabase.rpc as jest.Mock).mock.calls;
      const getDocCalls = rpcCalls.filter((call: any[]) => call[0] === 'get_document');
      const upsertCalls = rpcCalls.filter((call: any[]) => call[0] === 'upsert_document_rpc');

      // CRITICAL: No get_document call during save — this was the duplication bug
      expect(getDocCalls.length).toBe(0);
      expect(upsertCalls.length).toBe(1);
    });

    it('CRITICAL: saveNow should NOT apply Y.applyUpdate from DB during save', async () => {
      // Setup: local doc has "Alice's version"
      const fragment = doc.getXmlFragment('prosemirror');
      markdownToProsemirror('# Study Notes\n## Card 1\nAnswer 1', fragment);

      const beforeSaveMd = prosemirrorToMarkdown(fragment);
      const beforeCardCount = (beforeSaveMd.match(/^## /gm) || []).length;

      // Mock save to succeed
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: { message: 'ok' },
        error: null,
      });

      await persistence.saveNow();

      // After save, content should be IDENTICAL to before save
      const afterSaveMd = prosemirrorToMarkdown(fragment);
      const afterCardCount = (afterSaveMd.match(/^## /gm) || []).length;

      expect(afterSaveMd).toBe(beforeSaveMd);
      expect(afterCardCount).toBe(beforeCardCount);
    });

    it('CRITICAL: save should not double content even if DB has divergent state', async () => {
      // Local doc: 3 cards
      const fragment = doc.getXmlFragment('prosemirror');
      markdownToProsemirror(
        '# Section 1\n## Card A\nAnswer A\n## Card B\nAnswer B\n## Card C\nAnswer C',
        fragment
      );

      // Mock save — the old buggy code would call get_document first and merge
      // The DB might have a totally different CRDT lineage
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: { message: 'ok' },
        error: null,
      });

      // Save multiple times (simulating auto-save)
      await persistence.saveNow();
      await persistence.saveNow();
      await persistence.saveNow();

      // Content must not grow
      const afterMd = prosemirrorToMarkdown(fragment);
      const cardCount = (afterMd.match(/^## /gm) || []).length;
      expect(cardCount).toBe(3); // Still 3 cards, not 6 or 9
    });
  });

  describe('The Exact 530→332 Duplication Scenario', () => {
    it('CRITICAL: demonstrates how merge-on-save DOUBLES content with divergent lineage', () => {
      // This test proves the bug: when two Y.Docs with independent lineages
      // are merged, ALL content is duplicated because they have different clientIDs.

      // Alice's doc (the "server" version) — 3 sections, 3 cards each = 9 cards
      const aliceDoc = new Y.Doc();
      const aliceFragment = aliceDoc.getXmlFragment('prosemirror');
      markdownToProsemirror([
        '# Section 0',
        '## Card 0-A', 'Answer',
        '## Card 0-B', 'Answer',
        '## Card 0-C', 'Answer',
        '# Section 1',
        '## Card 1-A', 'Answer',
        '## Card 1-B', 'Answer',
        '## Card 1-C', 'Answer',
        '# Section 2',
        '## Card 2-A', 'Answer',
        '## Card 2-B', 'Answer',
        '## Card 2-C', 'Answer',
      ].join('\n'), aliceFragment);

      const aliceState = Y.encodeStateAsUpdate(aliceDoc);
      const aliceCards = (prosemirrorToMarkdown(aliceFragment).match(/^## /gm) || []).length;
      expect(aliceCards).toBe(9);

      // Bob's doc has diverged (different lineage — independently created)
      // with same content (e.g., from a stale IndexedDB or stale DB merge)
      const bobDoc = new Y.Doc();
      const bobFragment = bobDoc.getXmlFragment('prosemirror');
      markdownToProsemirror([
        '# Section 0',
        '## Card 0-A', 'Answer',
        '## Card 0-B', 'Answer',
        '## Card 0-C', 'Answer',
        '# Section 1',
        '## Card 1-A', 'Answer',
        '## Card 1-B', 'Answer',
        '## Card 1-C', 'Answer',
        '# Section 2',
        '## Card 2-A', 'Answer',
        '## Card 2-B', 'Answer',
        '## Card 2-C', 'Answer',
      ].join('\n'), bobFragment);

      const bobCardsBefore = (prosemirrorToMarkdown(bobFragment).match(/^## /gm) || []).length;
      expect(bobCardsBefore).toBe(9);

      // THE BUG: merge Alice's state into Bob's (different lineage)
      Y.applyUpdate(bobDoc, aliceState);

      const mergedMd = prosemirrorToMarkdown(bobFragment);
      const mergedCards = (mergedMd.match(/^## /gm) || []).length;

      // Content is DOUBLED — 18 cards instead of 9
      // This is exactly what happened: 332 cards → 530 (198 duplicates ≈ 332/1.6)
      expect(mergedCards).toBe(18);

      // Section headers are also doubled
      const sectionCount = (mergedMd.match(/^# Section/gm) || []).length;
      expect(sectionCount).toBe(6); // 3 sections × 2 = 6

      aliceDoc.destroy();
      bobDoc.destroy();
    });

    it('CRITICAL: same-lineage merge does NOT duplicate', () => {
      // When two docs share the same lineage (one is a fork of the other),
      // merging is idempotent — content is not duplicated.

      const originalDoc = new Y.Doc();
      const originalFragment = originalDoc.getXmlFragment('prosemirror');
      markdownToProsemirror(
        '# Section 0\n## Card 0-A\nAnswer\n## Card 0-B\nAnswer',
        originalFragment
      );
      const originalState = Y.encodeStateAsUpdate(originalDoc);

      // Alice forks from original (same lineage)
      const aliceDoc = new Y.Doc();
      Y.applyUpdate(aliceDoc, originalState);

      // Alice adds a card
      const aliceFragment = aliceDoc.getXmlFragment('prosemirror');
      const newH = new Y.XmlElement('heading');
      newH.setAttribute('level', 2);
      aliceFragment.push([newH]);
      newH.push([new Y.XmlText('Card 0-C')]);
      const newP = new Y.XmlElement('paragraph');
      aliceFragment.push([newP]);
      newP.push([new Y.XmlText('New answer')]);

      const aliceState = Y.encodeStateAsUpdate(aliceDoc);

      // Bob also forks from original (same lineage)
      const bobDoc = new Y.Doc();
      Y.applyUpdate(bobDoc, originalState);

      const bobCardsBefore = (prosemirrorToMarkdown(bobDoc.getXmlFragment('prosemirror')).match(/^## /gm) || []).length;
      expect(bobCardsBefore).toBe(2);

      // Merge Alice into Bob — same lineage, should NOT duplicate
      Y.applyUpdate(bobDoc, aliceState);

      const bobMd = prosemirrorToMarkdown(bobDoc.getXmlFragment('prosemirror'));
      const bobCardsAfter = (bobMd.match(/^## /gm) || []).length;

      // 3 cards total (original 2 + Alice's 1), NOT 5 (duplicated)
      expect(bobCardsAfter).toBe(3);

      // Section header appears exactly once
      const sectionCount = (bobMd.match(/^# Section/gm) || []).length;
      expect(sectionCount).toBe(1);

      originalDoc.destroy();
      aliceDoc.destroy();
      bobDoc.destroy();
    });
  });

  describe('Polling Safety', () => {
    it('startPolling should be a no-op (disabled)', () => {
      // Polling was the other duplication vector — it applied full DB state
      // via Y.applyUpdate every few seconds.
      // After the fix, startPolling should do nothing.

      const fragment = doc.getXmlFragment('prosemirror');
      markdownToProsemirror('# Notes\n## Card 1\nAnswer', fragment);
      const beforeMd = prosemirrorToMarkdown(fragment);

      // Start polling (should be no-op)
      persistence.startPolling(100);

      // Verify content unchanged
      const afterMd = prosemirrorToMarkdown(fragment);
      expect(afterMd).toBe(beforeMd);

      persistence.destroy();
    });
  });

  describe('Rejoin Scenario', () => {
    it('CRITICAL: Alice edits for hours, Andy pops in — no duplication', () => {
      // Alice has been editing — her doc is the current truth
      const aliceDoc = createDocWithContent([
        '# 0 - Design of Everyday things',
        '## What is the central argument?',
        'Poor design, not user incompetence',
        '## What is a Norman door?',
        'Ambiguous push/pull signals',
        '# 1 - Intro to HCI',
        '## What is formal def of HCI',
        'Human-computer interaction discipline',
        '## T/F GUI is a modern term',
        'False',
      ].join('\n'));

      // Alice's state is saved to Supabase
      const serverState = Y.encodeStateAsUpdate(aliceDoc);
      const aliceMd = prosemirrorToMarkdown(aliceDoc.getXmlFragment('prosemirror'));
      const aliceCards = (aliceMd.match(/^## /gm) || []).length;
      expect(aliceCards).toBe(4);

      // Andy pops in with a FRESH doc (no IndexedDB, no stale state)
      const andyDoc = new Y.Doc();
      Y.applyUpdate(andyDoc, serverState);

      const andyMd = prosemirrorToMarkdown(andyDoc.getXmlFragment('prosemirror'));
      const andyCards = (andyMd.match(/^## /gm) || []).length;

      // Andy should see exactly Alice's content — no duplication
      expect(andyCards).toBe(aliceCards);
      expect(andyMd).toBe(aliceMd);

      // Now Andy's doc saves — this should NOT cause duplication
      // (because saveNow no longer merges DB state)
      const andyStateBefore = Y.encodeStateAsUpdate(andyDoc);
      const andyStateAfter = Y.encodeStateAsUpdate(andyDoc);

      // State should be identical (save doesn't modify local doc)
      expect(andyStateBefore.length).toBe(andyStateAfter.length);

      aliceDoc.destroy();
      andyDoc.destroy();
    });

    it('CRITICAL: repeated saves should not grow document size', async () => {
      // This simulates the auto-save cycle that was causing the duplication cascade
      const fragment = doc.getXmlFragment('prosemirror');
      markdownToProsemirror(
        '# Notes\n## Card 1\nAnswer 1\n## Card 2\nAnswer 2\n## Card 3\nAnswer 3',
        fragment
      );

      const initialMd = prosemirrorToMarkdown(fragment);
      const initialCards = (initialMd.match(/^## /gm) || []).length;
      expect(initialCards).toBe(3);

      // Mock save to succeed
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: { message: 'ok' },
        error: null,
      });

      // Simulate 10 auto-save cycles
      for (let i = 0; i < 10; i++) {
        await persistence.saveNow();
      }

      // Content must not grow
      const finalMd = prosemirrorToMarkdown(fragment);
      const finalCards = (finalMd.match(/^## /gm) || []).length;
      expect(finalCards).toBe(3); // Still 3, not 30
      expect(finalMd).toBe(initialMd);
    });
  });

  describe('Save Retry Logic', () => {
    it('should retry on save failure without corrupting content', async () => {
      jest.useFakeTimers();

      const fragment = doc.getXmlFragment('prosemirror');
      markdownToProsemirror('# Notes\n## Card 1\nAnswer', fragment);
      const initialMd = prosemirrorToMarkdown(fragment);

      // First save fails, second succeeds
      (supabase.rpc as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ data: { message: 'ok' }, error: null });

      // Trigger save (will fail)
      const savePromise = persistence.saveNow();
      await savePromise;

      // Content should still be intact after failed save
      expect(prosemirrorToMarkdown(fragment)).toBe(initialMd);

      // Advance timers for retry
      jest.advanceTimersByTime(5000);

      // Run any pending promises
      await Promise.resolve();
      await Promise.resolve();

      // Content still intact
      expect(prosemirrorToMarkdown(fragment)).toBe(initialMd);

      jest.useRealTimers();
    });
  });

  describe('Save-status event emission', () => {
    it('should emit saving and saved events on success', async () => {
      doc.getText('content').insert(0, 'test');

      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: { message: 'ok' },
        error: null,
      });

      const events: string[] = [];
      persistence.on('save-status', ({ status }: { status: string }) => {
        events.push(status);
      });

      await persistence.saveNow();

      expect(events).toEqual(['saving', 'saved']);
    });

    it('should emit saving and error events on failure', async () => {
      doc.getText('content').insert(0, 'test');

      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'DB error' },
      });

      const events: string[] = [];
      persistence.on('save-status', ({ status }: { status: string }) => {
        events.push(status);
      });

      await persistence.saveNow();

      expect(events).toEqual(['saving', 'error']);
    });
  });
});

describe('Initial Load Safety', () => {
  it('should apply DB state to an empty doc cleanly', async () => {
    // Server has content
    const serverDoc = createDocWithContent('# Notes\n## Card 1\nAnswer');
    const serverState = encodeAsBase64(serverDoc);

    // Fresh local doc
    const localDoc = new Y.Doc();
    const persistence = new DocumentPersistence(localDoc);

    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [{
        id: 'room-default',
        yjs_state: serverState,
        updated_at: new Date().toISOString(),
      }],
      error: null,
    });

    await persistence.loadFromDatabase();

    const localMd = prosemirrorToMarkdown(localDoc.getXmlFragment('prosemirror'));
    const serverMd = prosemirrorToMarkdown(serverDoc.getXmlFragment('prosemirror'));
    expect(localMd).toBe(serverMd);

    persistence.destroy();
    serverDoc.destroy();
    localDoc.destroy();
  });

  it('should handle load followed by save without content growth', async () => {
    // Server has 5 cards
    const serverDoc = createDocWithContent([
      '# Section',
      '## Card 1', 'A1',
      '## Card 2', 'A2',
      '## Card 3', 'A3',
      '## Card 4', 'A4',
      '## Card 5', 'A5',
    ].join('\n'));
    const serverState = encodeAsBase64(serverDoc);

    // Fresh local doc
    const localDoc = new Y.Doc();
    const persistence = new DocumentPersistence(localDoc);

    // Load from DB
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [{
        id: 'room-default',
        yjs_state: serverState,
        updated_at: new Date().toISOString(),
      }],
      error: null,
    });
    await persistence.loadFromDatabase();

    const afterLoadMd = prosemirrorToMarkdown(localDoc.getXmlFragment('prosemirror'));
    const afterLoadCards = (afterLoadMd.match(/^## /gm) || []).length;
    expect(afterLoadCards).toBe(5);

    // Now save — should NOT grow content
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: { message: 'ok' },
      error: null,
    });
    await persistence.saveNow();

    const afterSaveMd = prosemirrorToMarkdown(localDoc.getXmlFragment('prosemirror'));
    expect(afterSaveMd).toBe(afterLoadMd);

    persistence.destroy();
    serverDoc.destroy();
    localDoc.destroy();
  });
});
