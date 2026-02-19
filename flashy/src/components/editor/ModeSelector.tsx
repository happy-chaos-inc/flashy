import { Code, Edit, Palette } from 'lucide-react';
import './ModeSelector.css';

export type EditorMode = 'wysiwyg' | 'markdown' | 'canvas';

interface ModeSelectorProps {
  currentMode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
}

export function ModeSelector({ currentMode, onModeChange }: ModeSelectorProps) {
  return (
    <div className="mode-selector-toggle">
      <button
        className={`mode-toggle-button ${currentMode === 'markdown' ? 'active' : ''}`}
        onClick={() => onModeChange('markdown')}
        title="Markdown mode"
      >
        <Code size={16} />
      </button>
      <button
        className={`mode-toggle-button ${currentMode === 'wysiwyg' ? 'active' : ''}`}
        onClick={() => onModeChange('wysiwyg')}
        title="WYSIWYG mode"
      >
        <Edit size={16} />
      </button>
      <button
        className={`mode-toggle-button ${currentMode === 'canvas' ? 'active' : ''}`}
        onClick={() => onModeChange('canvas')}
        title="Canvas mode"
      >
        <Palette size={16} />
      </button>
    </div>
  );
}
