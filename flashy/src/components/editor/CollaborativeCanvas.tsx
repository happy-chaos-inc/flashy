import { useRef, useEffect, useState, useCallback } from 'react';
import { Map as YMap } from 'yjs';
import { collaborationManager } from '../../lib/CollaborationManager';
import { CanvasToolbar } from './CanvasToolbar';
import { logger } from '../../lib/logger';
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

interface CollaborativeCanvasProps {
  isActive: boolean;
  flashcards: Flashcard[];
}

interface RemoteCursor {
  x: number;
  y: number;
  name: string;
  color: string;
  dragging?: string;
}

const CARD_WIDTH = 200;
const CARD_HEIGHT = 140;
const CARD_COLORS = ['#B399D4', '#7C9CE5', '#E57C7C', '#E5B97C', '#7CE5A3', '#E57CC8', '#7CE5D4', '#C5E57C'];

export function CollaborativeCanvas({ isActive, flashcards }: CollaborativeCanvasProps) {
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
  const [remoteCursors, setRemoteCursors] = useState<Map<number, RemoteCursor>>(new Map());
  const [activeTool, setActiveTool] = useState<'select' | 'connect'>('select');

  const positionsMapRef = useRef<YMap<any> | null>(null);
  const connectionsMapRef = useRef<YMap<any> | null>(null);
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panStartOffsetRef = useRef({ x: 0, y: 0 });
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const providerRef = useRef<any>(null);
  const zoomRef = useRef(1);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const screenToWorld = useCallback((screenX: number, screenY: number): { x: number; y: number } => {
    const container = containerRef.current;
    if (!container) return { x: screenX, y: screenY };
    const rect = container.getBoundingClientRect();
    return {
      x: (screenX - rect.left - panOffsetRef.current.x) / zoomRef.current,
      y: (screenY - rect.top - panOffsetRef.current.y) / zoomRef.current,
    };
  }, []);

  // Sync positions from Y.Map
  const syncPositions = useCallback(() => {
    const posMap = positionsMapRef.current;
    if (!posMap) return;
    const positions: Record<string, CardPosition> = {};
    posMap.forEach((val: any, key: string) => {
      positions[key] = val;
    });
    setCardPositions(positions);
  }, []);

  // Sync connections from Y.Map
  const syncConnections = useCallback(() => {
    const connMap = connectionsMapRef.current;
    if (!connMap) return;
    const conns: Connection[] = [];
    connMap.forEach((val: any) => {
      conns.push(val);
    });
    setConnections(conns);
  }, []);

  // Connect to Yjs
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const init = async () => {
      try {
        const { ydoc, provider } = await collaborationManager.connect();
        providerRef.current = provider;

        const posMap = ydoc.getMap('canvas-card-positions');
        const connMap = ydoc.getMap('canvas-connections');
        positionsMapRef.current = posMap;
        connectionsMapRef.current = connMap;

        const posObserver = () => syncPositions();
        const connObserver = () => syncConnections();
        posMap.observe(posObserver);
        connMap.observe(connObserver);

        // Remote cursors via awareness
        const awarenessHandler = () => {
          const states = provider.awareness.getStates();
          const cursors = new Map<number, RemoteCursor>();
          states.forEach((state: any, clientId: number) => {
            if (clientId !== ydoc.clientID && state.canvasCursor) {
              cursors.set(clientId, {
                x: state.canvasCursor.x,
                y: state.canvasCursor.y,
                name: state.user?.name || 'Anonymous',
                color: state.user?.color || '#6b7280',
                dragging: state.canvasCursor.dragging,
              });
            }
          });
          setRemoteCursors(cursors);
        };
        provider.awareness.on('change', awarenessHandler);

        syncPositions();
        syncConnections();

        cleanup = () => {
          posMap.unobserve(posObserver);
          connMap.unobserve(connObserver);
          provider.awareness.off('change', awarenessHandler);
        };
      } catch (error) {
        logger.error('Failed to connect canvas to Yjs:', error);
      }
    };

    init();
    return () => cleanup?.();
  }, [syncPositions, syncConnections]);

  // Auto-layout new cards that don't have positions yet
  useEffect(() => {
    const posMap = positionsMapRef.current;
    if (!posMap || flashcards.length === 0) return;

    // Group cards by section for cluster layout
    const sections: Record<string, Flashcard[]> = {};
    flashcards.forEach(card => {
      const section = card.section || 'Unsorted';
      if (!sections[section]) sections[section] = [];
      sections[section].push(card);
    });

    let needsLayout = false;
    const sectionNames = Object.keys(sections);

    sectionNames.forEach((sectionName, sectionIndex) => {
      const sectionCards = sections[sectionName];
      const cols = Math.ceil(Math.sqrt(sectionCards.length));
      const sectionOffsetX = sectionIndex * (cols * (CARD_WIDTH + 30) + 100);

      sectionCards.forEach((card, cardIndex) => {
        if (!posMap.has(card.id)) {
          needsLayout = true;
          const row = Math.floor(cardIndex / cols);
          const col = cardIndex % cols;
          const colorIndex = sectionIndex % CARD_COLORS.length;
          posMap.set(card.id, {
            x: sectionOffsetX + col * (CARD_WIDTH + 30) + 50,
            y: row * (CARD_HEIGHT + 30) + 80,
            color: CARD_COLORS[colorIndex],
          });
        }
      });
    });

    if (needsLayout) syncPositions();
  }, [flashcards, syncPositions]);

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

    const posMap = positionsMapRef.current;
    if (posMap) {
      const existing = posMap.get(draggingCard) || {};
      posMap.set(draggingCard, { ...existing, x: newX, y: newY });
    }

    // Broadcast dragging state
    if (providerRef.current) {
      providerRef.current.awareness.setLocalStateField('canvasCursor', {
        x: pos.x, y: pos.y, dragging: draggingCard,
      });
    }
  }, [draggingCard, connectingFrom, screenToWorld]);

  const handleCardPointerUp = useCallback((e: React.PointerEvent, cardId?: string) => {
    if (connectingFrom && cardId && cardId !== connectingFrom) {
      // Create connection
      const connMap = connectionsMapRef.current;
      if (connMap) {
        const connId = `${connectingFrom}-${cardId}`;
        // Toggle: remove if exists
        if (connMap.has(connId)) {
          connMap.delete(connId);
        } else {
          connMap.set(connId, { from: connectingFrom, to: cardId });
        }
      }
    }
    setConnectingFrom(null);
    setConnectMousePos(null);

    if (draggingCard) {
      setDraggingCard(null);
      if (providerRef.current) {
        providerRef.current.awareness.setLocalStateField('canvasCursor', null);
      }
    }
  }, [draggingCard, connectingFrom]);

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
    // Broadcast cursor
    if (providerRef.current && isActive && !draggingCard) {
      const pos = screenToWorld(e.clientX, e.clientY);
      providerRef.current.awareness.setLocalStateField('canvasCursor', { x: pos.x, y: pos.y });
    }

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
    // Force re-render
    setZoom(z => z); // Trick to trigger re-render for pan
  }, [connectingFrom, draggingCard, isActive, screenToWorld]);

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

  // Auto-arrange cards in a grid
  const handleAutoArrange = useCallback(() => {
    const posMap = positionsMapRef.current;
    if (!posMap) return;

    const sections: Record<string, Flashcard[]> = {};
    flashcards.forEach(card => {
      const section = card.section || 'Unsorted';
      if (!sections[section]) sections[section] = [];
      sections[section].push(card);
    });

    const sectionNames = Object.keys(sections);
    sectionNames.forEach((sectionName, sectionIndex) => {
      const sectionCards = sections[sectionName];
      const cols = Math.ceil(Math.sqrt(sectionCards.length));
      const sectionOffsetX = sectionIndex * (cols * (CARD_WIDTH + 30) + 100);
      const colorIndex = sectionIndex % CARD_COLORS.length;

      sectionCards.forEach((card, cardIndex) => {
        const row = Math.floor(cardIndex / cols);
        const col = cardIndex % cols;
        const existing = posMap.get(card.id) || {};
        posMap.set(card.id, {
          ...existing,
          x: sectionOffsetX + col * (CARD_WIDTH + 30) + 50,
          y: row * (CARD_HEIGHT + 30) + 80,
          color: existing.color || CARD_COLORS[colorIndex],
        });
      });
    });

    // Reset view
    panOffsetRef.current = { x: 0, y: 0 };
    setZoom(1);
  }, [flashcards]);

  // Get card center for connection lines
  const getCardCenter = (cardId: string): { x: number; y: number } | null => {
    const pos = cardPositions[cardId];
    if (!pos) return null;
    return { x: pos.x + CARD_WIDTH / 2, y: pos.y + CARD_HEIGHT / 2 };
  };

  // Render connection lines
  const renderConnections = () => {
    return connections.map((conn, i) => {
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

      {/* Remote cursors */}
      {Array.from(remoteCursors.entries()).map(([clientId, cursor]) => {
        const screenX = cursor.x * zoom + panOffsetRef.current.x;
        const screenY = cursor.y * zoom + panOffsetRef.current.y;
        return (
          <div
            key={clientId}
            className="canvas-remote-cursor"
            style={{ left: screenX, top: screenY }}
          >
            <div className="canvas-remote-cursor-dot" style={{ backgroundColor: cursor.color }} />
            <span className="canvas-remote-cursor-label" style={{ backgroundColor: cursor.color }}>
              {cursor.name}{cursor.dragging ? ' (moving)' : ''}
            </span>
          </div>
        );
      })}

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
