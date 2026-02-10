import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView as EditorViewType } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { yCollab } from 'y-codemirror.next';
import { UndoManager } from 'yjs';
import { collaborationManager } from '../../lib/CollaborationManager';
import { EditorView as CMEditorView, ViewUpdate, ViewPlugin, Decoration, DecorationSet } from '@codemirror/view';
import { getCursorDataUrl } from '../../config/cursorSvg';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { foldedRanges } from '@codemirror/language';
import { RangeSet } from '@codemirror/state';
import './MarkdownEditor.css';

export function MarkdownEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!editorRef.current) return;

    console.log('🎨 MarkdownEditor: Initializing...');
    console.log('⏸️  Editor disabled until database syncs (Rule 2)');

    // Get Yjs doc and provider from singleton
    const { ydoc, provider } = collaborationManager.connect();
    const ytext = ydoc.getText('content');

    // Get local user's color for cursor
    const localUser = provider.awareness.getLocalState()?.user;
    const userColor = localUser?.color || '#6BCF7F';

    // Get cursor data URL from centralized config
    const cursorDataUrl = getCursorDataUrl(userColor);

    console.log('📊 Provider status:', {
      connected: provider.connected,
      clientID: ydoc.clientID,
      awarenessStates: provider.awareness.getStates().size,
      userColor,
    });

    // Wait for database to load before enabling editor (Rule 2)
    const waitForSync = async () => {
      console.log('⏳ Waiting for database to sync...');
      // Actually wait for database to finish loading
      await collaborationManager.waitForDatabaseSync();

      // CRITICAL: Wait 1 more second for real-time updates to arrive
      // The database might have old data, but real-time will send the latest
      console.log('⏳ Waiting for real-time updates...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      setIsReady(true);
      console.log('✅ Database synced - Editor ready!');
    };

    waitForSync();

    // Create undo manager for collaborative undo/redo
    const undoManager = new UndoManager(ytext);

    console.log('📄 Initial Yjs content length:', ytext.length);

    // Plugin to update fold gutter classes based on fold state
    const foldStatePlugin = ViewPlugin.fromClass(class {
      constructor(view: EditorView) {
        setTimeout(() => this.updateFoldGutters(view), 100);
      }

      update(update: ViewUpdate) {
        // Always update to catch fold state changes
        setTimeout(() => this.updateFoldGutters(update.view), 50);
      }

      updateFoldGutters(view: EditorView) {
        // Simple approach: check the marker character itself
        // › = folded (should show chevron right)
        // ⌄ = unfolded (should show chevron down)
        const allGutters = view.dom.querySelectorAll('.cm-foldGutter .cm-gutterElement');

        allGutters.forEach((gutter: Element) => {
          const span = gutter.querySelector('span');

          if (span && span.textContent) {
            // If marker is › (right arrow), content is folded
            if (span.textContent.includes('›')) {
              gutter.classList.add('folded');
            } else {
              gutter.classList.remove('folded');
            }
          }
        });
      }
    });

    // Create custom theme for local cursor color and custom mouse cursor
    const cursorTheme = CMEditorView.theme({
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: userColor,
        borderLeftWidth: '2px',
      },
      '.cm-selectionBackground': {
        backgroundColor: userColor + '40', // Add transparency
      },
      '.cm-content': {
        cursor: `url(${cursorDataUrl}) 0 0, text`,
      },
    });

    // Create CodeMirror editor with Yjs collaboration
    const state = EditorState.create({
      doc: ytext.toString(), // Set initial content from Yjs
      extensions: [
        basicSetup,
        markdown(),
        foldStatePlugin,
        keymap.of([indentWithTab]),
        yCollab(ytext, provider.awareness, {
          undoManager,
        }),
        cursorTheme,
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    console.log('📊 CodeMirror initialized with', view.state.doc.length, 'characters');

    // Disable editing until ready (Rule 2)
    if (!isReady) {
      view.contentDOM.setAttribute('contenteditable', 'false');
      view.contentDOM.style.opacity = '0.5';
    }

    // Add listeners to debug sync
    ytext.observe((event, transaction) => {
      const ytextContent = ytext.toString();
      const editorContent = view.state.doc.toString();

      console.log('📝 Yjs text changed:', {
        local: transaction.local,
        ytextLength: ytext.length,
        editorLength: view.state.doc.length,
        ytextPreview: ytextContent.substring(0, 50) + '...',
        editorPreview: editorContent.substring(0, 50) + '...',
        inSync: ytextContent === editorContent,
      });

      if (ytextContent !== editorContent) {
        console.warn('⚠️  MISMATCH: Yjs and CodeMirror out of sync!');
        console.log('  Yjs has:', ytextContent.length, 'chars');
        console.log('  Editor has:', editorContent.length, 'chars');
      }
    });

    provider.awareness.on('change', () => {
      const states = provider.awareness.getStates();
      console.log('👥 Awareness changed:', {
        totalUsers: states.size,
        localClientID: ydoc.clientID,
      });
      states.forEach((state: any, clientID: number) => {
        console.log(`  User ${clientID}:`, state.user);
      });
    });

    // Listen for scroll requests from flashcard clicks
    const handleScrollToLine = (event: any) => {
      const { lineNumber } = event.detail;
      if (!viewRef.current) return;

      const view = viewRef.current;
      const line = view.state.doc.line(lineNumber + 1); // CodeMirror lines are 1-indexed
      const pos = line.from;

      // Get the DOM element for the line and find the .cm-line element
      let element: HTMLElement | null = view.domAtPos(pos)?.node as HTMLElement;
      while (element && !element.classList?.contains('cm-line')) {
        element = element.parentElement;
      }

      if (element) {
        // Use native smooth scroll
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Add highlight effect after scroll completes
        setTimeout(() => {
          if (element) {
            element.classList.add('highlight-flash');
            setTimeout(() => {
              if (element) {
                element.classList.remove('highlight-flash');
              }
            }, 1000);
          }
        }, 800);
      }
    };

    window.addEventListener('scrollToLine', handleScrollToLine);

    console.log('✅ MarkdownEditor: Ready with collaborative cursors!');

    return () => {
      setIsReady(false);
      console.log('🧹 MarkdownEditor: Cleaning up...');
      window.removeEventListener('scrollToLine', handleScrollToLine);
      view.destroy();
      collaborationManager.disconnect();
      viewRef.current = null;
    };
  }, []);

  // Enable editor when ready (Rule 2)
  useEffect(() => {
    if (isReady && viewRef.current) {
      viewRef.current.contentDOM.setAttribute('contenteditable', 'true');
      viewRef.current.contentDOM.style.opacity = '1';
      console.log('⌨️  Editor enabled - ready for input');
    }
  }, [isReady]);

  return (
    <div className="markdown-editor-wrapper">
      <div className="breadcrumb">
        <span className="breadcrumb-item">Home</span>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-item">happy-chaos</span>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-item breadcrumb-current">untitled.md</span>
      </div>
      <div ref={editorRef} className="markdown-editor" />
    </div>
  );
}
