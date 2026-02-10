import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { yCollab } from 'y-codemirror.next';
import { UndoManager } from 'yjs';
import { collaborationManager } from '../../lib/CollaborationManager';
import { EditorView as CMEditorView, ViewUpdate, ViewPlugin } from '@codemirror/view';
import { getCursorDataUrl } from '../../config/cursorSvg';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import './MarkdownEditor.css';

export function MarkdownEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!editorRef.current) return;

    console.log('🎨 MarkdownEditor: Initializing...');
    console.log('⏸️  Editor disabled until database syncs (Rule 2)');

    let view: EditorView | null = null;
    let cleanupCalled = false;

    // Async initialization
    (async () => {
      try {
        // Get Yjs doc and provider from singleton (async now for room capacity check)
        const { ydoc, provider, userInfo } = await collaborationManager.connect();
        const ytext = ydoc.getText('content');

        // Get local user's color for cursor - single source of truth from CollaborationManager
        const userColor = userInfo.color;

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

        // Check if ref is still valid (component might have unmounted)
        if (!editorRef.current) return;

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
            // Exception sink AFTER yCollab so it doesn't interfere
            EditorView.exceptionSink.of((exception) => {
              console.warn('⚠️ CodeMirror exception caught:', exception);
              // Check if it's the remote selection error
              if (exception.message?.includes('RelativePosition')) {
                console.warn('   Remote caret rendering failed (document length mismatch)');
              }
              // Don't crash the editor
              return true; // handled
            }),
            cursorTheme,
          ],
        });

        view = new EditorView({
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
          const editorContent = view!.state.doc.toString();

          console.log('📝 Yjs text changed:', {
            local: transaction.local,
            ytextLength: ytext.length,
            editorLength: view!.state.doc.length,
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
            console.log(`  User ${clientID}:`, {
              user: state.user,
              textCaret: state.cursor, // Text caret position (from yCollab)
              mouseCursor: state.mouse, // Mouse position (custom)
              selection: state.selection, // Text selection range
            });

            // Debug: Check if remote text carets are being tracked
            if (clientID !== ydoc.clientID) {
              if (state.cursor) {
                console.log(`  🎯 Remote TEXT CARET at:`, state.cursor);
              }
              if (state.mouse) {
                console.log(`  🖱️  Remote MOUSE at:`, state.mouse);
              }
            }
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
            // Get both scrollable containers - the outer markdown-editor and CodeMirror's scroller
            const editorContainer = view.dom.parentElement; // .markdown-editor
            const cmScroller = view.scrollDOM; // .cm-scroller (CodeMirror's internal scroller)

            // Use native smooth scroll for vertical only, nearest for horizontal
            element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

            // Force horizontal scroll to leftmost position on BOTH scrollable elements
            const resetHorizontalScroll = () => {
              if (editorContainer) editorContainer.scrollLeft = 0;
              if (cmScroller) cmScroller.scrollLeft = 0;
            };

            // Reset multiple times to override smooth scroll animation
            resetHorizontalScroll(); // Immediately
            requestAnimationFrame(resetHorizontalScroll); // Next frame
            setTimeout(resetHorizontalScroll, 100); // During animation
            setTimeout(resetHorizontalScroll, 300); // Mid animation
            setTimeout(resetHorizontalScroll, 500); // After animation

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
      } catch (error: any) {
        console.error('❌ Failed to initialize editor:', error);
        // Room full error is handled by EditorPage
      }
    })();

    return () => {
      if (cleanupCalled) return;
      cleanupCalled = true;

      setIsReady(false);
      console.log('🧹 MarkdownEditor: Cleaning up...');
      if (view) {
        window.removeEventListener('scrollToLine', () => {});
        view.destroy();
      }
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
