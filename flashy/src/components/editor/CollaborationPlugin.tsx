import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot } from 'lexical';
import { supabase } from '../../config/supabase';

export default function CollaborationPlugin() {
  const [editor] = useLexicalComposerContext();
  const isReceivingRef = useRef(false);
  const pendingStateRef = useRef<string | null>(null);

  useEffect(() => {
    console.log('🔧 Starting fast collaboration...');

    // Use a unique channel per document - better for WebSocket routing
    const channel = supabase.channel('doc-collab', {
      config: {
        broadcast: {
          self: false,
          ack: false, // Don't wait for acknowledgment - faster
        },
      },
    });

    // Receive updates - apply immediately
    channel.on('broadcast', { event: 'sync' }, ({ payload }: any) => {
      if (!isReceivingRef.current && payload.state) {
        isReceivingRef.current = true;
        pendingStateRef.current = payload.state;

        // Use queueMicrotask for immediate execution
        queueMicrotask(() => {
          try {
            const state = editor.parseEditorState(pendingStateRef.current!);
            editor.setEditorState(state);
          } catch (e) {
            console.error('Sync error:', e);
          }
          isReceivingRef.current = false;
          pendingStateRef.current = null;
        });
      }
    });

    // Send updates immediately on every change
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      if (isReceivingRef.current) return;

      const state = JSON.stringify(editorState.toJSON());

      // Send immediately - no batching, no debounce
      channel.send({
        type: 'broadcast',
        event: 'sync',
        payload: { state },
      });
    });

    // Subscribe with faster timeout
    channel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Fast sync ready');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ Connection error - check Supabase');
      }
    });

    return () => {
      unregister();
      channel.unsubscribe();
    };
  }, [editor]);

  return null;
}
