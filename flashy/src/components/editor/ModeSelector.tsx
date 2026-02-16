import { useState } from 'react';
import { Edit, Code } from 'lucide-react';
import './ModeSelector.css';

export type EditorMode = 'wysiwyg' | 'markdown';

interface ModeSelectorProps {
  currentMode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
}

export function ModeSelector({ currentMode, onModeChange }: ModeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const modes = [
    { id: 'wysiwyg' as EditorMode, label: 'WYSIWYG', icon: Edit, description: 'Visual editor' },
    { id: 'markdown' as EditorMode, label: 'Markdown', icon: Code, description: 'Code editor' },
  ];

  const currentModeData = modes.find(m => m.id === currentMode) || modes[1]; // Default to markdown for now

  return (
    <div className="mode-selector">
      <button
        className="mode-selector-button"
        onClick={() => setIsOpen(!isOpen)}
        title={`Current mode: ${currentModeData.label}`}
      >
        <currentModeData.icon size={18} />
        <span className="mode-label">{currentModeData.label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="mode-selector-backdrop" onClick={() => setIsOpen(false)} />
          <div className="mode-selector-dropdown">
            {modes.map((mode) => (
              <button
                key={mode.id}
                className={`mode-option ${currentMode === mode.id ? 'active' : ''}`}
                onClick={() => {
                  onModeChange(mode.id);
                  setIsOpen(false);
                }}
              >
                <mode.icon size={16} />
                <div className="mode-option-text">
                  <span className="mode-option-label">{mode.label}</span>
                  <span className="mode-option-description">{mode.description}</span>
                </div>
                {currentMode === mode.id && (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
