import { MousePointer2, Link2, LayoutGrid } from 'lucide-react';
import './CollaborativeCanvas.css';

interface CanvasToolbarProps {
  activeTool: 'select' | 'connect';
  onToolChange: (tool: 'select' | 'connect') => void;
  onAutoArrange: () => void;
  cardCount: number;
  connectionCount: number;
}

export function CanvasToolbar({
  activeTool,
  onToolChange,
  onAutoArrange,
  cardCount,
  connectionCount,
}: CanvasToolbarProps) {
  return (
    <div className="canvas-toolbar">
      <button
        className={`canvas-tool-btn ${activeTool === 'select' ? 'active' : ''}`}
        onClick={() => onToolChange('select')}
        title="Select & drag cards"
      >
        <MousePointer2 size={16} />
      </button>
      <button
        className={`canvas-tool-btn ${activeTool === 'connect' ? 'active' : ''}`}
        onClick={() => onToolChange('connect')}
        title="Draw connections between cards"
      >
        <Link2 size={16} />
      </button>

      <div className="canvas-divider" />

      <button className="canvas-tool-btn" onClick={onAutoArrange} title="Auto-arrange cards">
        <LayoutGrid size={16} />
      </button>

      <div className="canvas-divider" />

      <span className="canvas-toolbar-info">
        {cardCount} cards{connectionCount > 0 ? ` · ${connectionCount} links` : ''}
      </span>
    </div>
  );
}
