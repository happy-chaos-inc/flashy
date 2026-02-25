import { MousePointer2, Link2, LayoutGrid, Maximize } from 'lucide-react';
import './CollaborativeCanvas.css';

interface CanvasToolbarProps {
  activeTool: 'select' | 'connect';
  onToolChange: (tool: 'select' | 'connect') => void;
  onAutoArrange: () => void;
  onCenterView: () => void;
  cardCount: number;
  connectionCount: number;
}

export function CanvasToolbar({
  activeTool,
  onToolChange,
  onAutoArrange,
  onCenterView,
  cardCount,
  connectionCount,
}: CanvasToolbarProps) {
  return (
    <div className="canvas-toolbar" onPointerDown={(e) => e.stopPropagation()}>
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

      <button className="canvas-tool-btn canvas-tool-btn-labeled" onClick={onAutoArrange} title="Re-group cards by section">
        <LayoutGrid size={14} />
        <span>Re-group</span>
      </button>
      <button className="canvas-tool-btn canvas-tool-btn-labeled" onClick={onCenterView} title="Fit all cards in view">
        <Maximize size={14} />
        <span>Center</span>
      </button>

      <div className="canvas-divider" />

      <span className="canvas-toolbar-info">
        {cardCount} cards{connectionCount > 0 ? ` · ${connectionCount} links` : ''}
      </span>
    </div>
  );
}
