import { useAuth } from '../hooks/useAuth';
import { MarkdownEditor } from '../components/editor/MarkdownEditor';
import { VersionHistory } from '../components/editor/VersionHistory';
import { OnlineUsers } from '../components/editor/OnlineUsers';
import { MouseCursors } from '../components/editor/MouseCursors';
import { Logo } from '../components/Logo';
import { StudyMode } from '../components/StudyMode';
import { collaborationManager } from '../lib/CollaborationManager';
import { useEffect, useState } from 'react';
import { Star, Lock, Clock, ChevronLeft, ChevronRight, Play, Edit2, X, HelpCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import './EditorPage.css';

interface Flashcard {
  id: string;
  term: string;
  definition: string;
  lineNumber: number;
  section?: string;
}

export function EditorPage() {
  // Single source of truth for editor and sidebar minimum widths
  const MIN_PANEL_WIDTH = 400;
  const MARGIN_LEFT = 24;
  const MARGIN_GAP = 36;
  const TOTAL_MARGIN = MARGIN_LEFT + MARGIN_GAP; // 60

  const { logout } = useAuth();
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showStudyMode, setShowStudyMode] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const [isDragging, setIsDragging] = useState(false);
  const [clickedCardId, setClickedCardId] = useState<string | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [previewCardIds, setPreviewCardIds] = useState<Set<string>>(new Set());
  const [flippedCardIds, setFlippedCardIds] = useState<Set<string>>(new Set());
  const [starredCards, setStarredCards] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('starredCards');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  const handleLogout = () => {
    logout();
    // No navigation - auth state change will trigger re-render
  };

  const handleRestore = async (version: number) => {
    // Access the persistence layer from the collaboration manager
    const persistence = (collaborationManager as any).persistence;
    if (persistence) {
      await persistence.restoreVersion(version);
    } else {
      throw new Error('Persistence not initialized');
    }
  };

  // Parse flashcards from markdown content
  const parseFlashcards = (content: string): Flashcard[] => {
    const lines = content.split('\n');
    const cards: Flashcard[] = [];
    let currentSection = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match H1 headers: # Section
      const h1Match = line.match(/^#\s+(.+)$/);
      if (h1Match) {
        currentSection = h1Match[1].trim();
        continue;
      }

      // Match H2 headers: ## Term
      const h2Match = line.match(/^##\s+(.+)$/);
      if (h2Match) {
        const term = h2Match[1].trim();

        // Collect all content until next header (H1 or H2)
        let definition = '';
        let j = i + 1;
        while (j < lines.length && !lines[j].match(/^#{1,2}\s+/)) {
          definition += lines[j] + '\n';
          j++;
        }

        cards.push({
          id: `card-${i}`,
          term,
          definition: definition.trim(),
          lineNumber: i,
          section: currentSection || undefined,
        });
      }
    }

    return cards;
  };

  // Handle flashcard click - expand card in place
  const handleFlashcardClick = (card: Flashcard) => {
    const newPreviewIds = new Set(previewCardIds);
    if (newPreviewIds.has(card.id)) {
      // Remove from preview
      newPreviewIds.delete(card.id);
      // Also remove from flipped
      const newFlippedIds = new Set(flippedCardIds);
      newFlippedIds.delete(card.id);
      setFlippedCardIds(newFlippedIds);
    } else {
      // Add to preview
      newPreviewIds.add(card.id);
    }
    setPreviewCardIds(newPreviewIds);
  };

  const togglePreviewFlip = (cardId: string) => {
    const newFlippedIds = new Set(flippedCardIds);
    if (newFlippedIds.has(cardId)) {
      newFlippedIds.delete(cardId);
    } else {
      newFlippedIds.add(cardId);
    }
    setFlippedCardIds(newFlippedIds);
  };

  // Toggle star on flashcard
  const toggleStar = (cardId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Don't trigger card click
    const newStarred = new Set(starredCards);
    if (newStarred.has(cardId)) {
      newStarred.delete(cardId);
    } else {
      newStarred.add(cardId);
    }
    setStarredCards(newStarred);
    localStorage.setItem('starredCards', JSON.stringify(Array.from(newStarred)));
  };

  // Handle resizing
  const handleMouseDown = () => {
    setIsDragging(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const newWidth = window.innerWidth - e.clientX;
      // Ensure sidebar is at least MIN_PANEL_WIDTH AND editor maintains MIN_PANEL_WIDTH
      const maxWidth = window.innerWidth - (TOTAL_MARGIN + MIN_PANEL_WIDTH);
      if (newWidth >= MIN_PANEL_WIDTH && newWidth <= maxWidth) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging]);

  // Add scroll listener for navbar effect
  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY > 20;
      setIsScrolled(scrolled);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Subscribe to document changes
  useEffect(() => {
    const { ydoc } = collaborationManager.connect();
    const ytext = ydoc.getText('content');

    // Initial parse
    const initialCards = parseFlashcards(ytext.toString());
    setFlashcards(initialCards);

    // Listen for changes
    const observer = () => {
      const content = ytext.toString();
      const cards = parseFlashcards(content);
      setFlashcards(cards);
    };

    ytext.observe(observer);

    return () => {
      ytext.unobserve(observer);
    };
  }, []);

  return (
    <div className="editor-page" style={{
      '--sidebar-width': `${sidebarWidth}px`,
      '--min-panel-width': `${MIN_PANEL_WIDTH}px`
    } as React.CSSProperties}>
      <MouseCursors />
      <div className={`editor-header ${isScrolled ? 'scrolled' : ''}`}>
        <div className="editor-title-container">
          <Logo size={40} />
          <h1 className="editor-title">Flashy</h1>
        </div>
        <div className="header-actions">
          <OnlineUsers />
          <VersionHistory onRestore={handleRestore} />
          <button onClick={handleLogout} className="lock-button">
            <Lock size={16} /> Lock
          </button>
        </div>
      </div>

      <div className="editor-content">
        <MarkdownEditor />
      </div>

      <div
        className="resize-handle"
        style={{ right: `${sidebarWidth + 30}px` }}
        onMouseDown={handleMouseDown}
      >
        <div
          className="resize-stick"
          style={{ right: `${sidebarWidth + 30}px` }}
        />
      </div>

      {/* Sidebar rendered with fixed positioning */}
      <div className="flashcard-sidebar">
          <div className="flashcard-header">
            <div className="flashcard-title-row">
              <div className="flashcard-title-left">
                <button
                  className="back-button"
                  title="Toggle sidebar"
                  onClick={() => {
                    const maxWidth = window.innerWidth - (TOTAL_MARGIN + MIN_PANEL_WIDTH);
                    if (sidebarWidth >= maxWidth - 5) {
                      // At max, toggle to min
                      setSidebarWidth(MIN_PANEL_WIDTH);
                    } else if (sidebarWidth <= MIN_PANEL_WIDTH + 5) {
                      // At min, toggle to max
                      setSidebarWidth(maxWidth);
                    } else {
                      // In middle, toggle to max
                      setSidebarWidth(maxWidth);
                    }
                  }}
                >
                  {(() => {
                    const maxWidth = window.innerWidth - (TOTAL_MARGIN + MIN_PANEL_WIDTH);
                    if (sidebarWidth >= maxWidth - 5) {
                      return <ChevronRight size={24} />;
                    } else {
                      return <ChevronLeft size={24} />;
                    }
                  })()}
                </button>
                <h3>Flashcards</h3>
              </div>
              <span className="flashcard-count">{flashcards.length} cards</span>
            </div>
            {flashcards.length > 0 && (
              <div className="toolbar-row">
                <button
                  className="study-button"
                  onClick={() => setShowStudyMode(true)}
                  title="Start studying"
                >
                  <Play size={20} fill="currentColor" />
                  Learn
                </button>
                <button
                  className="toolbar-icon-button"
                  title="Starred only"
                >
                  <Star size={20} fill="none" />
                </button>
                <button
                  className="toolbar-icon-button"
                  title="Unknown"
                >
                  <HelpCircle size={20} />
                </button>
              </div>
            )}
          </div>
              {flashcards.length === 0 ? (
                <p className="sidebar-placeholder">
                  Add H2 headers (## Term) to create flashcards
                </p>
              ) : (
                <div className="flashcard-list">
                  {(() => {
                    let lastSection = '';
                    return flashcards.map((card) => {
                      const showSection = card.section && card.section !== lastSection;
                      lastSection = card.section || '';
                      return (
                        <div key={card.id}>
                          {showSection && (
                            <div className="flashcard-section">{card.section}</div>
                          )}

                          {previewCardIds.has(card.id) ? (
                            // Expanded preview card
                            <div className="sidebar-card-preview">
                              <div
                                className={`sidebar-preview-card ${flippedCardIds.has(card.id) ? 'flipped' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePreviewFlip(card.id);
                                }}
                              >
                                <div className="sidebar-preview-card-front">
                                  <div className="card-header-row">
                                    <button
                                      className="preview-back-button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleFlashcardClick(card);
                                      }}
                                    >
                                      <span style={{ display: 'flex', alignItems: 'center', gap: '2px', pointerEvents: 'none' }}>
                                        <ChevronLeft size={14} />
                                        Back
                                      </span>
                                    </button>
                                    <div className="card-label">Term</div>
                                  </div>
                                  <div className="card-content">{card.term}</div>
                                </div>
                                <div className="sidebar-preview-card-back">
                                  <div className="card-header-row">
                                    <button
                                      className="preview-back-button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleFlashcardClick(card);
                                      }}
                                    >
                                      <span style={{ display: 'flex', alignItems: 'center', gap: '2px', pointerEvents: 'none' }}>
                                        <ChevronLeft size={14} />
                                        Back
                                      </span>
                                    </button>
                                    <div className="card-label">Definition</div>
                                  </div>
                                  <div className="card-content card-content-markdown">
                                    <ReactMarkdown>{card.definition}</ReactMarkdown>
                                  </div>
                                </div>
                              </div>
                              <div className="preview-hint">Click to flip</div>
                            </div>
                          ) : (
                            // Normal flashcard
                            <div
                              className={`flashcard ${clickedCardId === card.id ? 'clicked' : ''} ${starredCards.has(card.id) ? 'starred' : ''}`}
                              onClick={() => handleFlashcardClick(card)}
                            >
                              <div className="flashcard-content-wrapper">
                                <div className="flashcard-top-row">
                                  <div className="flashcard-term">{card.term}</div>
                                  <div className="flashcard-icons">
                                    <button
                                      className="icon-button edit"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.dispatchEvent(new CustomEvent('scrollToLine', {
                                          detail: { lineNumber: card.lineNumber }
                                        }));
                                      }}
                                      title="Edit in editor"
                                    >
                                      <Edit2 size={18} />
                                    </button>
                                    <button
                                      className={`icon-button star ${starredCards.has(card.id) ? 'starred' : ''}`}
                                      onClick={(e) => toggleStar(card.id, e)}
                                      title={starredCards.has(card.id) ? 'Unstar' : 'Star'}
                                    >
                                      <Star size={18} fill={starredCards.has(card.id) ? 'currentColor' : 'none'} />
                                    </button>
                                  </div>
                                </div>
                                {card.definition && (
                                  <div className="flashcard-definition">{card.definition}</div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
      </div>

      {showStudyMode && flashcards.length > 0 && (
        <StudyMode
          flashcards={flashcards}
          starredCards={starredCards}
          onClose={() => setShowStudyMode(false)}
        />
      )}
    </div>
  );
}
