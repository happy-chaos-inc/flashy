import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Heading from '@tiptap/extension-heading';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import { Extension } from '@tiptap/core';
import { useEffect, useState } from 'react';
import { collaborationManager } from '../../lib/CollaborationManager';
import { logger } from '../../lib/logger';
import { Bold, Italic, List, ListOrdered, Code, Heading1, Heading2 } from 'lucide-react';
import './TiptapEditor.css';
import * as Y from 'yjs';

// Custom Heading extension that handles string levels from y-prosemirror
// y-prosemirror passes attributes as-is from Y.XmlElement, so "2" (string) needs to work
const CustomHeading = Heading.extend({
  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: element => {
          const level = element.getAttribute('level');
          return level ? parseInt(level, 10) : parseInt(element.tagName.replace('H', ''), 10);
        },
        renderHTML: attributes => {
          // Normalize level to number for rendering
          const level = typeof attributes.level === 'string'
            ? parseInt(attributes.level, 10)
            : attributes.level;
          return { 'data-level': level };
        },
      },
    };
  },
  // Override renderHTML to use normalized level for the HTML tag
  renderHTML({ node, HTMLAttributes }) {
    const level = typeof node.attrs.level === 'string'
      ? parseInt(node.attrs.level, 10)
      : node.attrs.level;
    const validLevel = [1, 2, 3, 4, 5, 6].includes(level) ? level : 1;
    return [`h${validLevel}`, HTMLAttributes, 0];
  },
});

// Custom extension for Tab key handling (LISTS ONLY)
// Rationale: Markdown can't represent paragraph indentation,
// so we only support Tab in lists where it has semantic meaning (nesting)
const TabIndentation = Extension.create({
  name: 'tabIndentation',

  addKeyboardShortcuts() {
    return {
      'Tab': () => {
        // Only handle Tab in lists (where it nests the item)
        // In regular paragraphs, do nothing (no indent support)
        if (this.editor.can().sinkListItem('listItem')) {
          return this.editor.commands.sinkListItem('listItem');
        }
        // Not in a list - let Tab go to next element (standard browser behavior)
        return false;
      },
      'Shift-Tab': () => {
        // Only handle Shift-Tab in lists (where it unnests)
        if (this.editor.can().liftListItem('listItem')) {
          return this.editor.commands.liftListItem('listItem');
        }
        // Not in a list - let Shift-Tab go to previous element
        return false;
      },
    };
  },
});

interface TiptapEditorProps {
  scrollTarget?: { position: number; timestamp: number } | null;
  isActive?: boolean; // Whether this editor is currently visible
}

/**
 * TiptapEditor - WYSIWYG editor bound directly to Y.XmlFragment
 *
 * Architecture:
 * - Y.XmlFragment is the ONLY source of truth
 * - Tiptap's Collaboration extension binds directly to Y.XmlFragment
 * - No sync needed - works natively with the canonical data structure
 */
export function TiptapEditor({ scrollTarget, isActive = true }: TiptapEditorProps) {
  const [isReady, setIsReady] = useState(false);
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<any>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const { ydoc, provider } = await collaborationManager.connect();
        await collaborationManager.waitForDatabaseSync();

        logger.log('📊 TiptapEditor: Connected to Y.XmlFragment');

        setYdoc(ydoc);
        setProvider(provider);
        setIsReady(true);
      } catch (error) {
        logger.error('Failed to initialize Tiptap editor:', error);
      }
    };

    init();

    return () => {
      collaborationManager.disconnect();
    };
  }, []);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          history: false, // Disable local history (use Y.js undo/redo)
          heading: false, // Disable default heading, use CustomHeading instead
        }),
        CustomHeading.configure({
          levels: [1, 2, 3, 4, 5, 6],
        }),
        Placeholder.configure({
          placeholder: 'Start typing...',
        }),
        TabIndentation, // Add Tab key support for list indentation
        ...(ydoc && provider
          ? [
              Collaboration.configure({
                fragment: ydoc.getXmlFragment('prosemirror'),
              }),
              CollaborationCursor.configure({
                provider: provider,
                user: {
                  name: provider.awareness?.getLocalState()?.user?.name || 'Anonymous',
                  color: provider.awareness?.getLocalState()?.user?.color || '#B399D4',
                },
              }),
            ]
          : []),
      ],
      editorProps: {
        attributes: {
          class: 'tiptap-editor',
        },
      },
      editable: isReady,
    },
    [ydoc, provider, isReady]
  );

  // Broadcast cursor position to awareness (for click-to-scroll feature)
  useEffect(() => {
    if (!editor || !provider) return;

    const updateCursorPosition = () => {
      const pos = editor.state.selection.anchor;
      provider.awareness.setLocalStateField('cursorPosition', pos);
    };

    // Update on selection change
    editor.on('selectionUpdate', updateCursorPosition);
    // Initial broadcast
    updateCursorPosition();

    return () => {
      editor.off('selectionUpdate', updateCursorPosition);
    };
  }, [editor, provider]);

  // Listen for local color changes and update TipTap cursor
  useEffect(() => {
    if (!editor || !provider) return;

    // Function to update mouse cursor
    const updateMouseCursor = (color: string) => {
      const editorElement = editor.view.dom as HTMLElement;
      if (editorElement) {
        const cursorUrl = `url(data:image/svg+xml;base64,${btoa(`
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" fill="${color}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `.trim())}) 0 0, text`;
        editorElement.style.cursor = cursorUrl;
        logger.log('🎨 TipTap: Mouse cursor updated to:', color);
      }
    };

    // Set initial mouse cursor
    const initialColor = provider.awareness.getLocalState()?.user?.color;
    if (initialColor) {
      updateMouseCursor(initialColor);
    }

    const unsubscribe = collaborationManager.onColorChange((newColor) => {
      logger.log('🎨 TipTap: Updating cursor color to:', newColor);

      // Update mouse cursor
      updateMouseCursor(newColor);

      // Update the user in CollaborationCursor
      const userName = provider.awareness.getLocalState()?.user?.name || 'Anonymous';
      try {
        editor.chain().updateUser({
          name: userName,
          color: newColor,
        }).run();
      } catch (e) {
        logger.warn('Could not update TipTap collaborative cursor:', e);
      }
    });

    return () => unsubscribe();
  }, [editor, provider]);

  // Listen for searchScrollTo events from the SearchBar
  useEffect(() => {
    if (!editor || !isActive) return;

    const handleSearchScroll = (e: Event) => {
      const { query, matchIndex } = (e as CustomEvent).detail;
      if (!query) return;

      const docSize = editor.state.doc.content.size;
      const fullText = editor.state.doc.textBetween(0, docSize, '\n', '\n');
      const needle = query.toLowerCase();
      let searchFrom = 0;
      let found = -1;

      for (let i = 0; i <= matchIndex; i++) {
        found = fullText.toLowerCase().indexOf(needle, searchFrom);
        if (found === -1) break;
        searchFrom = found + needle.length;
      }

      if (found === -1) return;

      // Map plain-text offset to ProseMirror position
      // Walk through doc nodes to find the correct position
      let charCount = 0;
      let pmFrom = 0;
      let pmTo = 0;
      editor.state.doc.descendants((node, pos) => {
        if (pmTo > 0) return false; // Already found
        if (node.isText && node.text) {
          const nodeStart = charCount;
          const nodeEnd = charCount + node.text.length;
          if (found >= nodeStart && found < nodeEnd) {
            const offset = found - nodeStart;
            pmFrom = pos + offset;
            pmTo = pmFrom + needle.length;
            return false;
          }
          charCount += node.text.length;
        } else if (node.isBlock && charCount > 0) {
          charCount += 1; // Account for newline between blocks
        }
        return true;
      });

      if (pmTo === 0) {
        // Fallback: use textBetween-based approximate mapping
        pmFrom = Math.min(found + 1, docSize - 1);
        pmTo = Math.min(pmFrom + needle.length, docSize);
      }

      try {
        editor.chain().focus().setTextSelection({ from: pmFrom, to: pmTo }).run();

        requestAnimationFrame(() => {
          const coords = editor.view.coordsAtPos(pmFrom);
          if (coords) {
            const resolvedPos = editor.state.doc.resolve(pmFrom);
            const depth = resolvedPos.depth > 0 ? resolvedPos.before(1) : 0;
            const domNode = editor.view.nodeDOM(depth);
            if (domNode instanceof HTMLElement) {
              domNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        });
      } catch (e) {
        logger.warn('Could not scroll to search match:', e);
      }
    };

    window.addEventListener('searchScrollTo', handleSearchScroll);
    return () => window.removeEventListener('searchScrollTo', handleSearchScroll);
  }, [editor, isActive]);

  // Handle scroll to target position (when clicking on another user)
  useEffect(() => {
    if (!scrollTarget || !editor) return;

    // TipTap positions are different from CodeMirror, but approximate
    const docLength = editor.state.doc.content.size;
    const pos = Math.min(Math.max(1, scrollTarget.position), docLength - 1);

    try {
      // Set selection first
      editor.chain()
        .focus()
        .setTextSelection(pos)
        .run();

      // Smooth scroll to the cursor position
      requestAnimationFrame(() => {
        const coords = editor.view.coordsAtPos(pos);
        if (coords) {
          // Find the closest block element to scroll to
          const resolvedPos = editor.state.doc.resolve(pos);
          const domNode = editor.view.nodeDOM(resolvedPos.before(1));

          if (domNode instanceof HTMLElement) {
            domNode.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });
          } else {
            // Fallback: scroll the editor container
            const editorElement = editor.view.dom.closest('.tiptap-editor');
            if (editorElement) {
              const editorRect = editorElement.getBoundingClientRect();
              const targetY = coords.top - editorRect.top + editorElement.scrollTop;
              const centerOffset = editorElement.clientHeight / 2;

              editorElement.scrollTo({
                top: targetY - centerOffset,
                behavior: 'smooth'
              });
            }
          }
        }
      });
    } catch (e) {
      logger.warn('Could not scroll to position:', e);
    }
  }, [scrollTarget, editor]);

  if (!isReady) {
    return (
      <div className="tiptap-loading">
        <div className="loading-spinner"></div>
        <p>Loading editor...</p>
      </div>
    );
  }

  return (
    <>
      <div className="tiptap-container">
        {editor && (
          <div className="tiptap-toolbar">
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={editor.isActive('bold') ? 'is-active' : ''}
              title="Bold (Ctrl+B)"
            >
              <Bold size={18} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={editor.isActive('italic') ? 'is-active' : ''}
              title="Italic (Ctrl+I)"
            >
              <Italic size={18} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={editor.isActive('code') ? 'is-active' : ''}
              title="Inline Code (Ctrl+E)"
            >
              <Code size={18} />
            </button>
            <div className="toolbar-divider" />
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}
              title="Heading 1"
            >
              <Heading1 size={18} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}
              title="Heading 2"
            >
              <Heading2 size={18} />
            </button>
            <div className="toolbar-divider" />
            <button
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={editor.isActive('bulletList') ? 'is-active' : ''}
              title="Bullet List"
            >
              <List size={18} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={editor.isActive('orderedList') ? 'is-active' : ''}
              title="Numbered List"
            >
              <ListOrdered size={18} />
            </button>
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </>
  );
}
