import { useEffect, useRef, useState } from 'react';
import { EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { collaborationManager } from '../../lib/CollaborationManager';
import { logger } from '../../lib/logger';
import {
  EditorView as CMEditorView,
  ViewUpdate,
  ViewPlugin,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  keymap,
} from '@codemirror/view';
import { getCursorDataUrl } from '../../config/cursorSvg';
import {
  indentWithTab,
  history,
  defaultKeymap,
  historyKeymap,
} from '@codemirror/commands';
import {
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldKeymap,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches } from '@codemirror/search';
import { prosemirrorToMarkdown } from '../../lib/prosemirrorToMarkdown';
import { markdownToProsemirror } from '../../lib/markdownToProsemirror';
import { collaborativeCursors } from '../../lib/codemirrorCursors';
import * as Y from 'yjs';
import './MarkdownEditor.css';

interface MarkdownEditorProps {
  scrollTarget?: { position: number; timestamp: number } | null;
  isActive?: boolean; // Whether this editor is currently visible
}

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
export function MarkdownEditor({ scrollTarget, isActive = true }: MarkdownEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Loop prevention flag - synchronous, not async
  const isRemoteUpdateRef = useRef(false);

  // Track active state for skipping observer updates when hidden
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // Debounce timer for markdown → Y.XmlFragment updates
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    logger.log('🎨 MarkdownEditor: Initializing as Y.XmlFragment lens...');

    let view: EditorView | null = null;
    let cleanupCalled = false;
    let yXmlFragment: Y.XmlFragment | null = null;
    let ydoc: Y.Doc | null = null;

    // Async initialization
    (async () => {
      try {
        // Get Yjs doc and provider
        const { ydoc: doc, provider, userInfo } = await collaborationManager.connect();
        ydoc = doc;
        yXmlFragment = doc.getXmlFragment('prosemirror');

        const userColor = userInfo.color;
        // Cursor data URL for potential future cursor styling
        void getCursorDataUrl(userColor);

        logger.log('📊 Connected to Y.XmlFragment:', {
          clientID: doc.clientID,
          fragmentLength: yXmlFragment.length,
        });

        // Wait for database sync
        await collaborationManager.waitForDatabaseSync();
        await new Promise(resolve => setTimeout(resolve, 1000));
        setIsReady(true);
        logger.log('✅ Database synced - Editor ready!');

        // Initial content: Serialize Y.XmlFragment to markdown
        const initialMarkdown = prosemirrorToMarkdown(yXmlFragment);
        logger.log('📄 Initial markdown from Y.XmlFragment:', initialMarkdown.substring(0, 100));

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

        // Set cursor color (can be updated dynamically)
        const setEditorCursorColor = (color: string) => {
          logger.log('🎨 setEditorCursorColor called with:', color);

          // Set CSS custom properties
          if (editorRef.current) {
            editorRef.current.style.setProperty('--user-cursor-color', color);
            editorRef.current.style.setProperty('--user-selection-color', color + '40');
          }

          // Also directly style the cursor elements (more reliable)
          const currentView = viewRef.current;
          if (currentView) {
            const cursors = currentView.dom.querySelectorAll('.cm-cursor, .cm-dropCursor');
            logger.log('🎨 Found cursor elements:', cursors.length);
            cursors.forEach((cursor: Element) => {
              (cursor as HTMLElement).style.borderLeftColor = color;
            });

            // Update mouse cursor
            currentView.contentDOM.style.cursor = `url(${getCursorDataUrl(color)}) 0 0, text`;
          }
        };
        setEditorCursorColor(userColor);

        // Create CodeMirror editor WITHOUT Y.js binding (but WITH collaborative cursors)
        const state = EditorState.create({
          doc: initialMarkdown,
          extensions: [
            // Individual extensions from basicSetup, excluding search panel
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightSpecialChars(),
            history(),
            foldGutter(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            indentOnInput(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            bracketMatching(),
            closeBrackets(),
            autocompletion(),
            rectangularSelection(),
            crosshairCursor(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            keymap.of([
              ...closeBracketsKeymap,
              ...defaultKeymap,
              ...historyKeymap,
              ...foldKeymap,
              ...completionKeymap,
              indentWithTab,
            ]),
            markdown(),
            foldStatePlugin,
            // Collaborative cursors - show remote carets
            collaborativeCursors(provider.awareness),
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

                  logger.log('📝 Parsing markdown and updating Y.XmlFragment...');

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
            logger.log('🔄 Skipping self-update');
            return;
          }

          // Skip if editor is hidden (not active) - prevents race conditions
          if (!isActiveRef.current) {
            logger.log('🔄 Skipping remote update - editor is hidden');
            return;
          }

          logger.log('🔄 Y.XmlFragment changed (remote), updating markdown view...');

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

        // Listen for local color changes (direct callback, not via awareness)
        const unsubscribeColorChange = collaborationManager.onColorChange((newColor) => {
          logger.log('🎨 MarkdownEditor: Updating cursor color to:', newColor);
          setEditorCursorColor(newColor);
        });

        logger.log('✅ MarkdownEditor: Ready as Y.XmlFragment lens!');

        // Cleanup function
        return () => {
          if (yXmlFragment) {
            yXmlFragment.unobserveDeep(xmlObserver);
          }
          unsubscribeColorChange();
        };
      } catch (error: any) {
        logger.error('❌ Failed to initialize editor:', error);
      }
    })();

    return () => {
      if (cleanupCalled) return;
      cleanupCalled = true;

      setIsReady(false);
      logger.log('🧹 MarkdownEditor: Cleaning up...');

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
      logger.log('⌨️  Editor enabled - ready for input');
    }
  }, [isReady]);

  // Re-sync content when editor becomes active (in case it missed updates while hidden)
  useEffect(() => {
    if (!isActive || !isReady || !viewRef.current) return;

    const resync = async () => {
      try {
        const { ydoc } = await collaborationManager.connect();
        const yXmlFragment = ydoc.getXmlFragment('prosemirror');

        const view = viewRef.current;
        if (!view) return;

        // Serialize Y.XmlFragment to markdown
        const newMarkdown = prosemirrorToMarkdown(yXmlFragment);
        const currentContent = view.state.doc.toString();

        // Only update if content has changed
        if (newMarkdown !== currentContent) {
          logger.log('🔄 Re-syncing markdown editor after becoming active');
          isRemoteUpdateRef.current = true;

          const cursorPos = view.state.selection.main.head;

          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: newMarkdown,
            },
          });

          // Restore cursor position
          const newLength = view.state.doc.length;
          const restoredPos = Math.min(cursorPos, newLength);
          view.dispatch({
            selection: { anchor: restoredPos },
          });

          isRemoteUpdateRef.current = false;
        }
      } catch (error) {
        logger.warn('Could not re-sync markdown:', error);
      }
    };

    resync();
  }, [isActive, isReady]);

  // Listen for searchScrollTo events from the SearchBar
  useEffect(() => {
    if (!isActive || !viewRef.current) return;

    const handleSearchScroll = (e: Event) => {
      const { query, matchIndex } = (e as CustomEvent).detail;
      const view = viewRef.current;
      if (!query || !view) return;

      const docText = view.state.doc.toString();
      const needle = query.toLowerCase();
      let searchFrom = 0;
      let found = -1;

      for (let i = 0; i <= matchIndex; i++) {
        found = docText.toLowerCase().indexOf(needle, searchFrom);
        if (found === -1) break;
        searchFrom = found + needle.length;
      }

      if (found === -1) return;

      view.dispatch({
        selection: { anchor: found, head: found + needle.length },
        scrollIntoView: true,
      });

      // Flash highlight
      requestAnimationFrame(() => {
        try {
          const line = view.state.doc.lineAt(found);
          const domAtPos = view.domAtPos(line.from);
          const lineElement = domAtPos?.node?.parentElement;
          if (lineElement) {
            lineElement.classList.add('highlight-flash');
            setTimeout(() => lineElement.classList.remove('highlight-flash'), 1000);
          }
        } catch {
          // Fallback - already scrolled via dispatch
        }
      });
    };

    window.addEventListener('searchScrollTo', handleSearchScroll);
    return () => window.removeEventListener('searchScrollTo', handleSearchScroll);
  }, [isActive, isReady]);

  // Handle scroll to target position (when clicking on another user)
  useEffect(() => {
    if (!scrollTarget || !viewRef.current) return;

    const view = viewRef.current;
    const pos = Math.min(scrollTarget.position, view.state.doc.length);

    // Set selection first (without auto-scroll)
    view.dispatch({
      selection: { anchor: pos },
    });

    // Get the line element and smooth scroll to it
    requestAnimationFrame(() => {
      try {
        const line = view.state.doc.lineAt(pos);
        const domAtPos = view.domAtPos(line.from);
        const lineElement = domAtPos?.node?.parentElement;

        if (lineElement) {
          // Smooth scroll to center the line
          lineElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });

          // Flash highlight effect after scroll completes
          setTimeout(() => {
            lineElement.classList.add('highlight-flash');
            setTimeout(() => lineElement.classList.remove('highlight-flash'), 1000);
          }, 300);
        }
      } catch (e) {
        // Fallback: use CodeMirror's built-in scroll
        view.dispatch({
          effects: CMEditorView.scrollIntoView(pos, { y: 'center' }),
        });
      }
    });
  }, [scrollTarget]);

  // Auto-hide header on scroll down, show on scroll up
  const [headerHidden, setHeaderHidden] = useState(false);
  const lastScrollTop = useRef(0);

  useEffect(() => {
    if (!viewRef.current) return;

    const scrollDOM = viewRef.current.scrollDOM;
    if (!scrollDOM) return;

    const handleScroll = () => {
      const currentScrollTop = scrollDOM.scrollTop;
      const scrollDelta = currentScrollTop - lastScrollTop.current;

      // Only trigger if scrolled more than 5px (debounce tiny movements)
      if (Math.abs(scrollDelta) > 5) {
        if (scrollDelta > 0 && currentScrollTop > 60) {
          // Scrolling down & past header height - hide
          setHeaderHidden(true);
        } else if (scrollDelta < 0) {
          // Scrolling up - show
          setHeaderHidden(false);
        }
        lastScrollTop.current = currentScrollTop;
      }

      // Always show header when at the very top
      if (currentScrollTop < 10) {
        setHeaderHidden(false);
      }
    };

    scrollDOM.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollDOM.removeEventListener('scroll', handleScroll);
  }, [isReady]);

  return (
    <div className="markdown-editor-wrapper">
      <div className={`breadcrumb ${headerHidden ? 'hidden' : ''}`}>
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
