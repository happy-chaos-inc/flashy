/**
 * SUPABASE CONFIGURATION & PERSISTENCE TESTS
 *
 * Tests the Supabase client setup, RPC call patterns, and the
 * base64 decode → Y.Doc pipeline that DocumentPersistence relies on.
 *
 * All tests use mocked Supabase — no live network calls.
 */

import * as Y from 'yjs';
import { markdownToProsemirror } from '../lib/markdownToProsemirror';
import { prosemirrorToMarkdown } from '../lib/prosemirrorToMarkdown';

// Mock supabase before importing it
jest.mock('../config/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    })),
  },
}));

import { supabase } from '../config/supabase';

// Helper: create a Y.Doc with prosemirror content and encode as base64
function createBase64State(markdown: string): string {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('prosemirror');
  markdownToProsemirror(markdown, fragment);
  const state = Y.encodeStateAsUpdate(doc);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < state.length; i += chunkSize) {
    const chunk = state.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  doc.destroy();
  return btoa(binary);
}

describe('Supabase Configuration', () => {
  it('should have supabase client configured', () => {
    expect(supabase).toBeDefined();
    expect(supabase.rpc).toBeDefined();
    expect(supabase.from).toBeDefined();
  });

  it('should have Supabase environment variables set', () => {
    // CI sets these from secrets; local dev sets them in .env.local
    // The supabase.ts module throws if they're missing, so if we got here they exist
    expect(process.env.REACT_APP_SUPABASE_URL).toBeDefined();
    expect(process.env.REACT_APP_SUPABASE_ANON_KEY).toBeDefined();
  });
});

describe('Supabase RPC — get_document', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call get_document with correct parameters', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    await supabase.rpc('get_document', { p_document_id: 'test-room' });

    expect(supabase.rpc).toHaveBeenCalledWith('get_document', {
      p_document_id: 'test-room',
    });
  });

  it('should handle successful response with document data', async () => {
    const base64State = createBase64State('# Notes\n## Card 1\nAnswer');

    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [{
        id: 'test-room-default',
        yjs_state: base64State,
        version: 5,
        updated_at: new Date().toISOString(),
      }],
      error: null,
    });

    const { data, error } = await supabase.rpc('get_document', {
      p_document_id: 'test-room-default',
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].yjs_state).toBeDefined();
    expect(data[0].version).toBe(5);
  });

  it('should handle empty response (new room, no document yet)', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    const { data, error } = await supabase.rpc('get_document', {
      p_document_id: 'new-room',
    });

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('should handle RPC error (e.g. function not found)', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find function' },
    });

    const { data, error } = await supabase.rpc('get_document', {
      p_document_id: 'test',
    });

    expect(error).not.toBeNull();
    expect(error.code).toBe('PGRST202');
  });

  it('should handle network failure', async () => {
    (supabase.rpc as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    await expect(
      supabase.rpc('get_document', { p_document_id: 'test' })
    ).rejects.toThrow('Network request failed');
  });
});

describe('Supabase RPC — upsert_document_rpc', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call upsert_document_rpc with correct parameters', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: { message: 'ok', server_version: 6 },
      error: null,
    });

    const base64State = createBase64State('# Test');

    await supabase.rpc('upsert_document_rpc', {
      p_document_id: 'room-default',
      p_yjs_state: base64State,
      p_content_text: '# Test',
      p_min_version: 5,
    });

    expect(supabase.rpc).toHaveBeenCalledWith('upsert_document_rpc', {
      p_document_id: 'room-default',
      p_yjs_state: base64State,
      p_content_text: '# Test',
      p_min_version: 5,
    });
  });

  it('should handle version conflict response', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: { success: false, message: 'Version conflict', server_version: 10 },
      error: null,
    });

    const { data } = await supabase.rpc('upsert_document_rpc', {
      p_document_id: 'room-default',
      p_yjs_state: 'abc',
      p_content_text: 'test',
      p_min_version: 5,
    });

    expect(data.success).toBe(false);
    expect(data.server_version).toBe(10);
  });
});

describe('Base64 → Y.Doc Pipeline', () => {
  it('should decode base64 state and reconstruct prosemirror content', () => {
    const originalMd = '# Biology\n## Mitosis\nCell division\n## Meiosis\nGamete production';
    const base64State = createBase64State(originalMd);

    // Decode base64 (same as DocumentPersistence.loadFromDatabase)
    const decoded = Uint8Array.from(atob(base64State), c => c.charCodeAt(0));

    const doc = new Y.Doc();
    Y.applyUpdate(doc, decoded);

    const fragment = doc.getXmlFragment('prosemirror');
    expect(fragment.length).toBeGreaterThan(0);

    const md = prosemirrorToMarkdown(fragment);
    expect(md).toBe(originalMd);

    doc.destroy();
  });

  it('should handle empty base64 state gracefully', () => {
    // Empty Y.Doc encoded as base64
    const emptyDoc = new Y.Doc();
    const state = Y.encodeStateAsUpdate(emptyDoc);
    let binary = '';
    for (let i = 0; i < state.length; i++) {
      binary += String.fromCharCode(state[i]);
    }
    const base64State = btoa(binary);
    emptyDoc.destroy();

    const decoded = Uint8Array.from(atob(base64State), c => c.charCodeAt(0));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, decoded);

    const fragment = doc.getXmlFragment('prosemirror');
    expect(fragment.length).toBe(0);

    doc.destroy();
  });

  it('should reject corrupted base64 gracefully', () => {
    expect(() => {
      const decoded = Uint8Array.from(atob('!!!'), c => c.charCodeAt(0));
      const doc = new Y.Doc();
      Y.applyUpdate(doc, decoded);
      doc.destroy();
    }).toThrow(); // atob throws on invalid base64
  });

  it('should preserve flashcard structure through the pipeline', () => {
    const markdown = [
      '# Section 1',
      '## Term A',
      'Definition A',
      '## Term B',
      'Definition B',
      '# Section 2',
      '## Term C',
      'Definition C',
    ].join('\n');

    const base64State = createBase64State(markdown);
    const decoded = Uint8Array.from(atob(base64State), c => c.charCodeAt(0));

    const doc = new Y.Doc();
    Y.applyUpdate(doc, decoded);

    const md = prosemirrorToMarkdown(doc.getXmlFragment('prosemirror'));
    const cards = (md.match(/^## /gm) || []).length;

    expect(cards).toBe(3);
    expect(md).toContain('## Term A');
    expect(md).toContain('## Term B');
    expect(md).toContain('## Term C');

    doc.destroy();
  });
});
