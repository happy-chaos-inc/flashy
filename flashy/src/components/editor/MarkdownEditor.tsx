import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { collaborationManager } from '../../lib/CollaborationManager';
import { EditorView as CMEditorView, ViewUpdate, ViewPlugin } from '@codemirror/view';
import { getCursorDataUrl } from '../../config/cursorSvg';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { prosemirrorToMarkdown } from '../../lib/prosemirrorToMarkdown';
import { markdownToProsemirror } from '../../lib/markdownToProsemirror';
import * as Y from 'yjs';
import './MarkdownEditor.css';

/**
 * MarkdownEditor - A markdown view/lens over Y.XmlFragment
 *
 * Architecture:
 * - Y.XmlFragment is the ONLY source of truth
 * - This editor is NOT bound to Y.js (no yCollab)
 * - Display: Serialize Y.XmlFragment → markdown
 * - Edit: Parse markdown → update Y.XmlFragment
 * - Loop prevention: Synchronous flag (isRemoteUpdate)
 */
export function MarkdownEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Loop prevention flag - synchronous, not async
  const isRemoteUpdateRef = useRef(false);

  // Debounce timer for markdown → Y.XmlFragment updates
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    console.log('🎨 MarkdownEditor: Initializing as Y.XmlFragment lens...');

    let view: EditorView | null = null;
    let cleanupCalled = false;
    let yXmlFragment: Y.XmlFragment | null = null;
    let ydoc: Y.Doc | null = null;

    // Async initialization
    (async () => {
      try {
        // Get Yjs doc and provider
        const { ydoc: doc, userInfo } = await collaborationManager.connect();
        ydoc = doc;
        yXmlFragment = doc.getXmlFragment('prosemirror');

        const userColor = userInfo.color;
        const cursorDataUrl = getCursorDataUrl(userColor);

        console.log('📊 Connected to Y.XmlFragment:', {
          clientID: doc.clientID,
          fragmentLength: yXmlFragment.length,
        });

        // Wait for database sync
        await collaborationManager.waitForDatabaseSync();
        await new Promise(resolve => setTimeout(resolve, 1000));
        setIsReady(true);
        console.log('✅ Database synced - Editor ready!');

        // Initial content: Serialize Y.XmlFragment to markdown
        const initialMarkdown = prosemirrorToMarkdown(yXmlFragment);
        console.log('📄 Initial markdown from Y.XmlFragment:', initialMarkdown.substring(0, 100));

        // Plugin to update fold gutter classes
        const foldStatePlugin = ViewPlugin.fromClass(class {
          constructor(view: EditorView) {
            setTimeout(() => this.updateFoldGutters(view), 100);
          }

          update(update: ViewUpdate) {
            setTimeout(() => this.updateFoldGutters(update.view), 50);
          }

          updateFoldGutters(view: EditorView) {
            const allGutters = view.dom.querySelectorAll('.cm-foldGutter .cm-gutterElement');
            allGutters.forEach((gutter: Element) => {
              const span = gutter.querySelector('span');
              if (span && span.textContent) {
                if (span.textContent.includes('›')) {
                  gutter.classList.add('folded');
                } else {
                  gutter.classList.remove('folded');
                }
              }
            });
          }
        });

        // Custom theme for cursor
        const cursorTheme = CMEditorView.theme({
          '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: userColor,
            borderLeftWidth: '2px',
          },
          '.cm-selectionBackground': {
            backgroundColor: userColor + '40',
          },
          '.cm-content': {
            cursor: `url(${cursorDataUrl}) 0 0, text`,
          },
        });

        // Create CodeMirror editor WITHOUT Y.js binding
        const state = EditorState.create({
          doc: initialMarkdown,
          extensions: [
            basicSetup,
            markdown(),
            foldStatePlugin,
            // Tab handling: indentWithTab works for lists and code blocks
            // Regular paragraphs don't support indentation (markdown ignores leading spaces)
            keymap.of([indentWithTab]),
            cursorTheme,
            // Change handler: Parse markdown and update Y.XmlFragment
            EditorView.updateListener.of((update: ViewUpdate) => {
              if (update.docChanged && !isRemoteUpdateRef.current) {
                // User edited in CodeMirror
                const newMarkdown = update.state.doc.toString();

                // Debounce updates to Y.XmlFragment (300ms)
                if (updateTimerRef.current) {
                  clearTimeout(updateTimerRef.current);
                }

                updateTimerRef.current = setTimeout(() => {
                  if (!ydoc || !yXmlFragment) return;

                  console.log('📝 Parsing markdown and updating Y.XmlFragment...');

                  // Parse markdown to ProseMirror and replace Y.XmlFragment
                  // Use transaction origin to identify this as our own update
                  ydoc.transact(() => {
                    yXmlFragment!.delete(0, yXmlFragment!.length);
                    markdownToProsemirror(newMarkdown, yXmlFragment!);
                  }, 'markdown-editor'); // Origin tag
                }, 300);
              }
            }),
          ],
        });

        if (!editorRef.current) return;

        view = new EditorView({
          state,
          parent: editorRef.current,
        });

        viewRef.current = view;

        // Disable editing until ready
        if (!isReady) {
          view.contentDOM.setAttribute('contenteditable', 'false');
          view.contentDOM.style.opacity = '0.5';
        }

        // Observer: Y.XmlFragment changes → serialize to markdown → update CodeMirror
        const xmlObserver = (events: any, transaction: any) => {
          if (!view || !yXmlFragment) return;

          // Skip if this is our own update (check transaction origin)
          if (transaction.origin === 'markdown-editor') {
            console.log('🔄 Skipping self-update');
            return;
          }

          console.log('🔄 Y.XmlFragment changed (remote), updating markdown view...');

          // Save cursor position
          const cursorPos = view.state.selection.main.head;

          // Serialize Y.XmlFragment to markdown
          isRemoteUpdateRef.current = true;
          const newMarkdown = prosemirrorToMarkdown(yXmlFragment);

          // Update CodeMirror content
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: newMarkdown,
            },
          });

          // Restore cursor position (best effort)
          const newLength = view.state.doc.length;
          const restoredPos = Math.min(cursorPos, newLength);
          view.dispatch({
            selection: { anchor: restoredPos },
          });

          isRemoteUpdateRef.current = false;
        };

        // Attach observer to Y.XmlFragment
        yXmlFragment.observeDeep(xmlObserver);

        console.log('✅ MarkdownEditor: Ready as Y.XmlFragment lens!');

        // Cleanup function
        return () => {
          if (yXmlFragment) {
            yXmlFragment.unobserveDeep(xmlObserver);
          }
        };
      } catch (error: any) {
        console.error('❌ Failed to initialize editor:', error);
      }
    })();

    return () => {
      if (cleanupCalled) return;
      cleanupCalled = true;

      setIsReady(false);
      console.log('🧹 MarkdownEditor: Cleaning up...');

      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }

      if (view) {
        view.destroy();
      }

      collaborationManager.disconnect();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enable editor when ready
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
