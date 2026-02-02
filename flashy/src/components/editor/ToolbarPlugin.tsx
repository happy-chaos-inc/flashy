import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useCallback, useEffect, useState } from 'react';
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { $setBlocksType } from '@lexical/selection';
import { $createHeadingNode, $createQuoteNode, HeadingTagType } from '@lexical/rich-text';
import { INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND } from '@lexical/list';
import './ToolbarPlugin.css';

export default function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [blockType, setBlockType] = useState('paragraph');

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      setIsBold(selection.hasFormat('bold'));
      setIsItalic(selection.hasFormat('italic'));
      setIsUnderline(selection.hasFormat('underline'));
    }
  }, []);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        updateToolbar();
        return false;
      },
      1
    );
  }, [editor, updateToolbar]);

  const formatBold = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
  };

  const formatItalic = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
  };

  const formatUnderline = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline');
  };

  const formatHeading = (headingSize: HeadingTagType) => {
    if (blockType !== headingSize) {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode(headingSize));
        }
      });
    }
  };

  const formatBulletList = () => {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  };

  const formatNumberedList = () => {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  };

  return (
    <div className="toolbar">
      <button
        onClick={formatBold}
        className={`toolbar-button ${isBold ? 'active' : ''}`}
        aria-label="Format Bold"
        title="Bold"
      >
        <strong>B</strong>
      </button>
      <button
        onClick={formatItalic}
        className={`toolbar-button ${isItalic ? 'active' : ''}`}
        aria-label="Format Italic"
        title="Italic"
      >
        <em>I</em>
      </button>
      <button
        onClick={formatUnderline}
        className={`toolbar-button ${isUnderline ? 'active' : ''}`}
        aria-label="Format Underline"
        title="Underline"
      >
        <u>U</u>
      </button>

      <div className="toolbar-divider" />

      <select
        className="toolbar-dropdown"
        onChange={(e) => {
          const value = e.target.value;
          if (value === 'h1' || value === 'h2' || value === 'h3') {
            formatHeading(value);
          }
        }}
        value={blockType}
      >
        <option value="paragraph">Normal</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>

      <div className="toolbar-divider" />

      <button
        onClick={formatBulletList}
        className="toolbar-button"
        aria-label="Bullet List"
        title="Bullet List"
      >
        • List
      </button>
      <button
        onClick={formatNumberedList}
        className="toolbar-button"
        aria-label="Numbered List"
        title="Numbered List"
      >
        1. List
      </button>
    </div>
  );
}
