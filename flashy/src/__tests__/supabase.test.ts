import { supabase } from '../config/supabase';
import * as Y from 'yjs';

describe('Supabase Configuration', () => {
  it('should have supabase client configured', () => {
    expect(supabase).toBeDefined();
  });

  it('should have correct environment variables', () => {
    expect(process.env.REACT_APP_SUPABASE_URL).toBeDefined();
    expect(process.env.REACT_APP_SUPABASE_ANON_KEY).toBeDefined();
  });
});

describe('Supabase RPC Functions', () => {
  it('should be able to call get_document RPC', async () => {
    const { data, error } = await supabase.rpc('get_document', {
      p_document_id: 'test-document'
    });

    // Should not throw error about function not existing
    if (error) {
      expect(error.code).not.toBe('PGRST202');
    }
  });
});

describe('Production Document Persistence', () => {
  const DOCUMENT_ID = 'main-document';
  const isRealSupabase = !process.env.REACT_APP_SUPABASE_URL?.includes('test.supabase.co');

  it('should fetch main-document from Supabase on startup', async () => {
    const { data, error } = await supabase.rpc('get_document', {
      p_document_id: DOCUMENT_ID,
    });

    // Skip network errors in local test environment (fake credentials)
    if (error?.details?.includes('Network request failed')) {
      console.log('⏭️  Skipping: No network access to Supabase (local test env)');
      return;
    }

    // RPC should succeed
    expect(error).toBeNull();

    // Document should exist
    expect(data).toBeDefined();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);

    // Document should have yjs_state
    const doc = data[0];
    expect(doc.yjs_state).toBeDefined();
    expect(doc.yjs_state).not.toBeNull();
    expect(typeof doc.yjs_state).toBe('string');
    expect(doc.yjs_state.length).toBeGreaterThan(0);

    console.log('✅ main-document exists with', doc.yjs_state.length, 'bytes of CRDT state');
  });

  it('should successfully apply fetched CRDT state to Y.Doc', async () => {
    const { data, error } = await supabase.rpc('get_document', {
      p_document_id: DOCUMENT_ID,
    });

    // Skip network errors in local test environment
    if (error?.details?.includes('Network request failed')) {
      console.log('⏭️  Skipping: No network access to Supabase (local test env)');
      return;
    }

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.length).toBeGreaterThan(0);

    const doc = data[0];
    expect(doc.yjs_state).toBeDefined();

    // Decode base64 and apply to Y.Doc
    const stateVector = Uint8Array.from(atob(doc.yjs_state), c => c.charCodeAt(0));

    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, stateVector);

    // Y.XmlFragment should have content (this is what editors use)
    const xmlFragment = ydoc.getXmlFragment('prosemirror');
    expect(xmlFragment.length).toBeGreaterThan(0);

    console.log('✅ Production document loaded successfully');
    console.log('   XmlFragment nodes:', xmlFragment.length);

    ydoc.destroy();
  });
});
