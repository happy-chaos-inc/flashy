import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { editorConfig } from '../../config/lexical';
import ToolbarPlugin from './ToolbarPlugin';
import CollaborationPlugin from './CollaborationPlugin';
import './LexicalEditor.css';

export function LexicalEditor() {
  return (
    <LexicalComposer initialConfig={editorConfig}>
      <div className="editor-wrapper">
        <ToolbarPlugin />
        <div className="editor-inner">
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="editor-input" />
            }
            placeholder={
              <div className="editor-placeholder">
                Start typing... Use Heading 1, 2, or 3 for flashcard questions.
                <br />
                The content below each heading becomes the answer!
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <CollaborationPlugin />
        </div>
      </div>
    </LexicalComposer>
  );
}
