import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import { Extension } from '@tiptap/core';
import { useEffect, useState } from 'react';
import { collaborationManager } from '../../lib/CollaborationManager';
import { Bold, Italic, List, ListOrdered, Code, Heading1, Heading2 } from 'lucide-react';
import './TiptapEditor.css';
import * as Y from 'yjs';

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

/**
 * TiptapEditor - WYSIWYG editor bound directly to Y.XmlFragment
 *
 * Architecture:
 * - Y.XmlFragment is the ONLY source of truth
 * - Tiptap's Collaboration extension binds directly to Y.XmlFragment
 * - No sync needed - works natively with the canonical data structure
 */
export function TiptapEditor() {
  const [isReady, setIsReady] = useState(false);
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<any>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const { ydoc, provider } = await collaborationManager.connect();

        console.log('📊 TiptapEditor: Connected to Y.XmlFragment');

        setYdoc(ydoc);
        setProvider(provider);
        setIsReady(true);
      } catch (error) {
        console.error('Failed to initialize Tiptap editor:', error);
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
        }),
        Placeholder.configure({
          placeholder: 'Start typing to create your first flashcard... (Use ## for headings)',
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
