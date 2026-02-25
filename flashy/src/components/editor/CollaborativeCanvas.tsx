import { useRef, useEffect, useState, useCallback } from 'react';
import { CanvasToolbar } from './CanvasToolbar';
import { Layers } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import './CollaborativeCanvas.css';

interface Flashcard {
  id: string;
  term: string;
  definition: string;
  lineNumber: number;
  section?: string;
}

interface CardPosition {
  x: number;
  y: number;
  flipped?: boolean;
  color?: string;
}

interface Connection {
  from: string;
  to: string;
  label?: string;
}

interface CanvasData {
  positions: Record<string, CardPosition>;
  connections: Connection[];
}

interface CollaborativeCanvasProps {
  isActive: boolean;
  flashcards: Flashcard[];
  roomId: string;
}

const CARD_WIDTH = 200;
const CARD_HEIGHT = 140;
const CARD_COLORS = ['#B399D4', '#7C9CE5', '#E57C7C', '#E5B97C', '#7CE5A3', '#E57CC8', '#7CE5D4', '#C5E57C'];

function getStorageKey(roomId: string): string {
  return `flashy-canvas-${roomId}`;
}

function loadCanvasData(roomId: string): CanvasData {
  try {
    const raw = localStorage.getItem(getStorageKey(roomId));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        positions: parsed.positions || {},
        connections: parsed.connections || [],
      };
    }
  } catch {
    // Corrupted data, start fresh
  }
  return { positions: {}, connections: [] };
}

function saveCanvasData(roomId: string, data: CanvasData): void {
  try {
    localStorage.setItem(getStorageKey(roomId), JSON.stringify(data));
  } catch {
    // localStorage full or unavailable
  }
}

export function CollaborativeCanvas({ isActive, flashcards, roomId }: CollaborativeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [cardPositions, setCardPositions] = useState<Record<string, CardPosition>>({});
  const [connections, setConnections] = useState<Connection[]>([]);
  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectMousePos, setConnectMousePos] = useState<{ x: number; y: number } | null>(null);
  const [flippedCards, setFlippedCards] = useState<Set<string>>(new Set());
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [, setPanTick] = useState(0); // Increment to force re-render during pan
  const [activeTool, setActiveTool] = useState<'select' | 'connect'>('select');

  const panOffsetRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panStartOffsetRef = useRef({ x: 0, y: 0 });
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  // Keep a mutable ref for positions so save helpers always see latest
  const positionsRef = useRef<Record<string, CardPosition>>({});
  const connectionsRef = useRef<Connection[]>([]);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Keep refs in sync with state
  useEffect(() => { positionsRef.current = cardPositions; }, [cardPositions]);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);

  // Save to localStorage whenever positions or connections change
  const persistToStorage = useCallback(() => {
    saveCanvasData(roomId, {
      positions: positionsRef.current,
      connections: connectionsRef.current,
    });
  }, [roomId]);

  const screenToWorld = useCallback((screenX: number, screenY: number): { x: number; y: number } => {
    const container = containerRef.current;
    if (!container) return { x: screenX, y: screenY };
    const rect = container.getBoundingClientRect();
    return {
      x: (screenX - rect.left - panOffsetRef.current.x) / zoomRef.current,
      y: (screenY - rect.top - panOffsetRef.current.y) / zoomRef.current,
    };
  }, []);

  // Load from localStorage on mount
  useEffect(() => {
    const data = loadCanvasData(roomId);
    setCardPositions(data.positions);
    setConnections(data.connections);
    positionsRef.current = data.positions;
    connectionsRef.current = data.connections;
  }, [roomId]);

  // Auto-layout new cards that don't have positions yet
  useEffect(() => {
    if (flashcards.length === 0) return;

    const currentPositions = positionsRef.current;

    // Group cards by section for cluster layout
    const sections: Record<string, Flashcard[]> = {};
    flashcards.forEach(card => {
      const section = card.section || 'Unsorted';
      if (!sections[section]) sections[section] = [];
      sections[section].push(card);
    });

    let needsLayout = false;
    const newPositions = { ...currentPositions };
    const sectionNames = Object.keys(sections);
    let cumulativeX = 50; // Start with left padding

    sectionNames.forEach((sectionName, sectionIndex) => {
      const sectionCards = sections[sectionName];
      const cols = Math.ceil(Math.sqrt(sectionCards.length));
      const sectionWidth = cols * (CARD_WIDTH + 30);

      sectionCards.forEach((card, cardIndex) => {
        if (!newPositions[card.id]) {
          needsLayout = true;
          const row = Math.floor(cardIndex / cols);
          const col = cardIndex % cols;
          const colorIndex = sectionIndex % CARD_COLORS.length;
          newPositions[card.id] = {
            x: cumulativeX + col * (CARD_WIDTH + 30),
            y: row * (CARD_HEIGHT + 30) + 80,
            color: CARD_COLORS[colorIndex],
          };
        }
      });

      cumulativeX += sectionWidth + 80; // Gap between sections
    });

    if (needsLayout) {
      setCardPositions(newPositions);
      positionsRef.current = newPositions;
      saveCanvasData(roomId, { positions: newPositions, connections: connectionsRef.current });
    }
  }, [flashcards, roomId]);

  // Handle card drag
  const handleCardPointerDown = useCallback((e: React.PointerEvent, cardId: string) => {
    if (activeTool === 'connect') {
      e.stopPropagation();
      setConnectingFrom(cardId);
      const pos = screenToWorld(e.clientX, e.clientY);
      setConnectMousePos(pos);
      return;
    }

    e.stopPropagation();
    const pos = screenToWorld(e.clientX, e.clientY);
    const cardPos = cardPositions[cardId];
    if (!cardPos) return;

    dragOffsetRef.current = { x: pos.x - cardPos.x, y: pos.y - cardPos.y };
    setDraggingCard(cardId);
    setSelectedCard(cardId);
    (e.target as HTMLElement).closest('.canvas-card')?.setPointerCapture(e.pointerId);
  }, [activeTool, cardPositions, screenToWorld]);

  const handleCardPointerMove = useCallback((e: React.PointerEvent) => {
    if (connectingFrom) {
      const pos = screenToWorld(e.clientX, e.clientY);
      setConnectMousePos(pos);
      return;
    }

    if (!draggingCard) return;
    const pos = screenToWorld(e.clientX, e.clientY);
    const newX = pos.x - dragOffsetRef.current.x;
    const newY = pos.y - dragOffsetRef.current.y;

    setCardPositions(prev => {
      const existing = prev[draggingCard] || {};
      const updated = { ...prev, [draggingCard]: { ...existing, x: newX, y: newY } };
      positionsRef.current = updated;
      return updated;
    });
  }, [draggingCard, connectingFrom, screenToWorld]);

  const handleCardPointerUp = useCallback((e: React.PointerEvent, cardId?: string) => {
    if (connectingFrom && cardId && cardId !== connectingFrom) {
      // Create connection (toggle: remove if exists)
      setConnections(prev => {
        const exists = prev.some(c => c.from === connectingFrom && c.to === cardId);
        const updated = exists
          ? prev.filter(c => !(c.from === connectingFrom && c.to === cardId))
          : [...prev, { from: connectingFrom, to: cardId }];
        connectionsRef.current = updated;
        saveCanvasData(roomId, { positions: positionsRef.current, connections: updated });
        return updated;
      });
    }
    setConnectingFrom(null);
    setConnectMousePos(null);

    if (draggingCard) {
      setDraggingCard(null);
      persistToStorage();
    }
  }, [draggingCard, connectingFrom, roomId, persistToStorage]);

  // Background pan
  const handleBackgroundPointerDown = useCallback((e: React.PointerEvent) => {
    // Deselect
    setSelectedCard(null);

    if (connectingFrom) {
      setConnectingFrom(null);
      setConnectMousePos(null);
      return;
    }

    isPanningRef.current = true;
    panStartRef.current = { x: e.clientX, y: e.clientY };
    panStartOffsetRef.current = { ...panOffsetRef.current };
    containerRef.current?.setPointerCapture(e.pointerId);
  }, [connectingFrom]);

  const handleBackgroundPointerMove = useCallback((e: React.PointerEvent) => {
    if (connectingFrom) {
      const pos = screenToWorld(e.clientX, e.clientY);
      setConnectMousePos(pos);
    }

    if (!isPanningRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    panOffsetRef.current = {
      x: panStartOffsetRef.current.x + dx,
      y: panStartOffsetRef.current.y + dy,
    };
    // Force re-render for pan
    setPanTick(t => t + 1);
  }, [connectingFrom, screenToWorld]);

  const handleBackgroundPointerUp = useCallback((e: React.PointerEvent) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      containerRef.current?.releasePointerCapture(e.pointerId);
    }
    if (connectingFrom) {
      setConnectingFrom(null);
      setConnectMousePos(null);
    }
  }, [connectingFrom]);

  // Zoom via scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      const newZoom = Math.max(0.2, Math.min(3, zoomRef.current * delta));

      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const scale = newZoom / zoomRef.current;

      panOffsetRef.current = {
        x: mx - scale * (mx - panOffsetRef.current.x),
        y: my - scale * (my - panOffsetRef.current.y),
      };

      setZoom(newZoom);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // Flip a card
  const toggleFlip = useCallback((cardId: string) => {
    setFlippedCards(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }, []);

  // Auto-arrange cards in a grid, grouped by section with no overlaps
  const handleAutoArrange = useCallback(() => {
    const sections: Record<string, Flashcard[]> = {};
    flashcards.forEach(card => {
      const section = card.section || 'Unsorted';
      if (!sections[section]) sections[section] = [];
      sections[section].push(card);
    });

    const sectionNames = Object.keys(sections);
    let cumulativeX = 50;
    const newPositions = { ...positionsRef.current };

    sectionNames.forEach((sectionName, sectionIndex) => {
      const sectionCards = sections[sectionName];
      const cols = Math.ceil(Math.sqrt(sectionCards.length));
      const sectionWidth = cols * (CARD_WIDTH + 30);
      const colorIndex = sectionIndex % CARD_COLORS.length;

      sectionCards.forEach((card, cardIndex) => {
        const row = Math.floor(cardIndex / cols);
        const col = cardIndex % cols;
        const existing = newPositions[card.id] || {};
        newPositions[card.id] = {
          ...existing,
          x: cumulativeX + col * (CARD_WIDTH + 30),
          y: row * (CARD_HEIGHT + 30) + 80,
          color: existing.color || CARD_COLORS[colorIndex],
        };
      });

      cumulativeX += sectionWidth + 80;
    });

    setCardPositions(newPositions);
    positionsRef.current = newPositions;
    saveCanvasData(roomId, { positions: newPositions, connections: connectionsRef.current });

    // Reset view
    panOffsetRef.current = { x: 0, y: 0 };
    setZoom(1);
  }, [flashcards, roomId]);

  // Center view on all cards
  const handleCenterView = useCallback(() => {
    if (flashcards.length === 0) return;
    const container = containerRef.current;
    if (!container) return;

    // Find bounding box of all cards
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    flashcards.forEach(card => {
      const pos = cardPositions[card.id];
      if (!pos) return;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + CARD_WIDTH);
      maxY = Math.max(maxY, pos.y + CARD_HEIGHT);
    });

    if (minX === Infinity) return;

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const containerRect = container.getBoundingClientRect();
    const padding = 60;

    // Fit zoom so all cards are visible
    const scaleX = (containerRect.width - padding * 2) / contentWidth;
    const scaleY = (containerRect.height - padding * 2) / contentHeight;
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.3), 1.5);

    // Center the content
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    panOffsetRef.current = {
      x: containerRect.width / 2 - centerX * newZoom,
      y: containerRect.height / 2 - centerY * newZoom,
    };
    setZoom(newZoom);
  }, [flashcards, cardPositions]);

  // Get card center for connection lines
  const getCardCenter = (cardId: string): { x: number; y: number } | null => {
    const pos = cardPositions[cardId];
    if (!pos) return null;
    return { x: pos.x + CARD_WIDTH / 2, y: pos.y + CARD_HEIGHT / 2 };
  };

  // Render connection lines
  const renderConnections = () => {
    return connections.map((conn) => {
      const from = getCardCenter(conn.from);
      const to = getCardCenter(conn.to);
      if (!from || !to) return null;

      return (
        <line
          key={`${conn.from}-${conn.to}`}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="#B399D4"
          strokeWidth={2 / zoom}
          strokeDasharray={`${6 / zoom},${4 / zoom}`}
          opacity={0.6}
          markerEnd="url(#arrowhead)"
        />
      );
    });
  };

  // Render in-progress connection line
  const renderPendingConnection = () => {
    if (!connectingFrom || !connectMousePos) return null;
    const from = getCardCenter(connectingFrom);
    if (!from) return null;

    return (
      <line
        x1={from.x}
        y1={from.y}
        x2={connectMousePos.x}
        y2={connectMousePos.y}
        stroke="#B399D4"
        strokeWidth={2 / zoom}
        strokeDasharray={`${4 / zoom},${4 / zoom}`}
        opacity={0.8}
      />
    );
  };

  return (
    <div
      ref={containerRef}
      className={`collaborative-canvas-container ${activeTool === 'connect' ? 'tool-connect' : ''} ${isPanningRef.current ? 'panning' : ''}`}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handleBackgroundPointerMove}
      onPointerUp={handleBackgroundPointerUp}
    >
      {/* Dot grid background */}
      <div
        className="canvas-dot-grid"
        style={{
          backgroundPosition: `${panOffsetRef.current.x}px ${panOffsetRef.current.y}px`,
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        }}
      />

      {/* Toolbar */}
      <CanvasToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        onAutoArrange={handleAutoArrange}
        onCenterView={handleCenterView}
        cardCount={flashcards.length}
        connectionCount={connections.length}
      />

      {/* SVG layer for connections */}
      <svg
        ref={svgRef}
        className="canvas-svg-layer"
        style={{
          transform: `translate(${panOffsetRef.current.x}px, ${panOffsetRef.current.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#B399D4" opacity="0.6" />
          </marker>
        </defs>
        {renderConnections()}
        {renderPendingConnection()}
      </svg>

      {/* Cards layer */}
      <div
        className="canvas-cards-layer"
        style={{
          transform: `translate(${panOffsetRef.current.x}px, ${panOffsetRef.current.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Section labels */}
        {(() => {
          const sectionPositions: Record<string, { minX: number; minY: number }> = {};
          flashcards.forEach(card => {
            const pos = cardPositions[card.id];
            if (!pos) return;
            const section = card.section || 'Unsorted';
            if (!sectionPositions[section]) {
              sectionPositions[section] = { minX: pos.x, minY: pos.y };
            } else {
              sectionPositions[section].minX = Math.min(sectionPositions[section].minX, pos.x);
              sectionPositions[section].minY = Math.min(sectionPositions[section].minY, pos.y);
            }
          });

          return Object.entries(sectionPositions).map(([section, pos]) => (
            <div
              key={`section-${section}`}
              className="canvas-section-label"
              style={{ left: pos.minX, top: pos.minY - 32 }}
            >
              {section}
            </div>
          ));
        })()}

        {/* Flashcards as sticky notes */}
        {flashcards.map(card => {
          const pos = cardPositions[card.id];
          if (!pos) return null;
          const isFlipped = flippedCards.has(card.id);
          const isSelected = selectedCard === card.id;
          const isDragging = draggingCard === card.id;
          const cardColor = pos.color || '#B399D4';

          return (
            <div
              key={card.id}
              className={`canvas-card ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${connectingFrom === card.id ? 'connecting-source' : ''}`}
              style={{
                left: pos.x,
                top: pos.y,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                '--card-color': cardColor,
              } as React.CSSProperties}
              onPointerDown={(e) => handleCardPointerDown(e, card.id)}
              onPointerMove={handleCardPointerMove}
              onPointerUp={(e) => handleCardPointerUp(e, card.id)}
              onDoubleClick={(e) => { e.stopPropagation(); toggleFlip(card.id); }}
            >
              <div className={`canvas-card-inner ${isFlipped ? 'flipped' : ''}`}>
                <div className="canvas-card-front" style={{ background: cardColor }}>
                  <div className="canvas-card-term">{card.term}</div>
                  {card.section && <div className="canvas-card-section">{card.section}</div>}
                </div>
                <div className="canvas-card-back" style={{ borderColor: cardColor }}>
                  <div className="canvas-card-definition">
                    <ReactMarkdown>{card.definition}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {flashcards.length === 0 && (
        <div className="canvas-empty-state">
          <div className="canvas-empty-icon"><Layers size={32} /></div>
          <div className="canvas-empty-title">No flashcards yet</div>
          <div className="canvas-empty-subtitle">Use ## headings in the editor to create cards</div>
        </div>
      )}

      {/* Zoom indicator */}
      {zoom !== 1 && (
        <div className="canvas-zoom-indicator">
          {Math.round(zoom * 100)}%
        </div>
      )}
    </div>
  );
}
