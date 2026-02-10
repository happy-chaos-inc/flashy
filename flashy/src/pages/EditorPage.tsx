import { useAuth } from '../hooks/useAuth';
import { MarkdownEditor } from '../components/editor/MarkdownEditor';
import { VersionHistory } from '../components/editor/VersionHistory';
import { OnlineUsers } from '../components/editor/OnlineUsers';
import { MouseCursors } from '../components/editor/MouseCursors';
import { Logo } from '../components/Logo';
import { StudyMode } from '../components/StudyMode';
import { CascadeStack } from '../components/CascadeStack';
import { collaborationManager } from '../lib/CollaborationManager';
import { useEffect, useState, useRef } from 'react';
import { Star, LogOut, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Play, Edit2, Info } from 'lucide-react';
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
  const [isAnimating, setIsAnimating] = useState(false);
  const [previewCardIds, setPreviewCardIds] = useState<Set<string>>(new Set());
  const [flippedCardIds, setFlippedCardIds] = useState<Set<string>>(new Set());
  const [starredCards, setStarredCards] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('starredCards');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [showOnlyStarred, setShowOnlyStarred] = useState(false);
  const [isRoomFull, setIsRoomFull] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [showInfoMenu, setShowInfoMenu] = useState(false);
  const infoMenuRef = useRef<HTMLDivElement>(null);

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

  // Toggle section collapse
  const toggleSectionCollapse = (sectionName: string) => {
    const newCollapsed = new Set(collapsedSections);
    if (newCollapsed.has(sectionName)) {
      newCollapsed.delete(sectionName);
    } else {
      newCollapsed.add(sectionName);
    }
    setCollapsedSections(newCollapsed);
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
  }, [isDragging, TOTAL_MARGIN, MIN_PANEL_WIDTH]);

  // Add scroll listener for navbar effect
  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY > 20;
      setIsScrolled(scrolled);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close info menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (infoMenuRef.current && !infoMenuRef.current.contains(event.target as Node)) {
        setShowInfoMenu(false);
      }
    };

    if (showInfoMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showInfoMenu]);

  // Subscribe to document changes
  useEffect(() => {
    const init = async () => {
      try {
        const { ydoc } = await collaborationManager.connect();
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
      } catch (error: any) {
        if (error.message === 'ROOM_FULL') {
          console.log('🚫 Room is full, cannot join');
          setIsRoomFull(true);
        } else {
          console.error('Failed to connect:', error);
        }
      }
    };

    init();
  }, []);

  // Show "party full" message if room is at capacity
  if (isRoomFull) {
    return (
      <div className="editor-page" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'linear-gradient(135deg, #F5E1FD 0%, #E8D5F2 100%)',
      }}>
        <div style={{
          textAlign: 'center',
          padding: '48px',
          background: 'rgba(255, 255, 255, 0.9)',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
          maxWidth: '500px',
        }}>
          <Logo size={80} />
          <h1 style={{
            fontSize: '32px',
            color: '#1f2937',
            marginTop: '24px',
            marginBottom: '16px',
          }}>
            Party's Full! 🎉
          </h1>
          <p style={{
            fontSize: '18px',
            color: '#6b7280',
            lineHeight: '1.6',
          }}>
            This study session has reached its maximum capacity of 8 users.
            Please try again later when someone leaves.
          </p>
          <button
            onClick={handleLogout}
            style={{
              marginTop: '32px',
              padding: '12px 32px',
              fontSize: '16px',
              fontWeight: 600,
              color: 'white',
              background: '#B399D4',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.background = '#9b7ec4'}
            onMouseOut={(e) => e.currentTarget.style.background = '#B399D4'}
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

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
            <LogOut size={22} />
          </button>
        </div>
      </div>

      <div className={`editor-content ${isAnimating ? 'animating' : ''}`}>
        <MarkdownEditor />
      </div>

      <div
        className={`resize-handle ${isAnimating ? 'animating' : ''}`}
        style={{ right: `${sidebarWidth + 30}px` }}
        onMouseDown={handleMouseDown}
      >
        <div
          className={`resize-stick ${isAnimating ? 'animating' : ''}`}
          style={{ right: `${sidebarWidth + 30}px` }}
        />
      </div>

      {/* Sidebar rendered with fixed positioning */}
      <div className={`flashcard-sidebar ${isAnimating ? 'animating' : ''}`}>
          <div className="flashcard-header">
            <div className="flashcard-title-row">
              <div className="flashcard-title-left">
                <button
                  className="back-button"
                  title="Toggle sidebar"
                  onClick={() => {
                    const maxWidth = window.innerWidth - (TOTAL_MARGIN + MIN_PANEL_WIDTH);
                    setIsAnimating(true);
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
                    setTimeout(() => setIsAnimating(false), 500);
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
              <span className="flashcard-count">
                {showOnlyStarred
                  ? `${flashcards.filter(card => starredCards.has(card.id)).length} starred`
                  : `${flashcards.length} cards`
                }
              </span>
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
                  className={`toolbar-icon-button ${showOnlyStarred ? 'active' : ''}`}
                  onClick={() => setShowOnlyStarred(!showOnlyStarred)}
                  title={showOnlyStarred ? "Show all cards" : "Show starred only"}
                >
                  <Star size={20} fill={showOnlyStarred ? "currentColor" : "none"} />
                </button>
                <div ref={infoMenuRef} style={{ position: 'relative' }}>
                  <button
                    className="toolbar-icon-button"
                    title="Info"
                    onClick={() => setShowInfoMenu(!showInfoMenu)}
                  >
                    <Info size={20} />
                  </button>
                  {showInfoMenu && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: '8px',
                      background: 'white',
                      border: '1px solid #ddd',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                      padding: '16px',
                      zIndex: 1000,
                      whiteSpace: 'nowrap'
                    }}>
                      <div style={{ fontSize: '14px', color: '#333', fontWeight: 500 }}>
                    made with dreams
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
              {flashcards.length === 0 ? (
                <p className="sidebar-placeholder">
                  Add H2 headers (## Term) to create flashcards
                </p>
              ) : showOnlyStarred && flashcards.filter(card => starredCards.has(card.id)).length === 0 ? (
                <p className="sidebar-placeholder">
                  No starred cards yet. Click the star icon on a card to add it to your favorites!
                </p>
              ) : (
                <>
                  {(() => {
                    const filteredCards = showOnlyStarred
                      ? flashcards.filter(card => starredCards.has(card.id))
                      : flashcards;

                    // Group cards by section
                    const sections: { [key: string]: typeof filteredCards } = {};
                    filteredCards.forEach(card => {
                      const sectionName = card.section || 'Unsorted';
                      if (!sections[sectionName]) {
                        sections[sectionName] = [];
                      }
                      sections[sectionName].push(card);
                    });

                    return Object.entries(sections).map(([sectionName, sectionCards]) => {
                      const isCollapsed = collapsedSections.has(sectionName);
                      return (
                        <div key={sectionName} className="flashcard-section-group">
                          <div
                            className="flashcard-section"
                            onClick={() => toggleSectionCollapse(sectionName)}
                            style={{ cursor: 'pointer', position: 'relative', textAlign: 'center' }}
                          >
                            <span className="section-collapse-icon" style={{ position: 'absolute', left: '0px', top: '50%', transform: 'translateY(-50%)' }}>
                              {isCollapsed ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
                            </span>
                            {sectionName}
                          </div>
                          {isCollapsed ? (
                            <div style={{ padding: '0 24px 16px 24px' }}>
                              <CascadeStack
                                key={`${sectionName}-${sectionCards.map(c => c.id).join('-')}`}
                                cards={sectionCards}
                                getCardBackground={(card) => starredCards.has(card.id) ? '#FEF3E2' : '#F9FAFB'}
                                getCardBorderColor={(card) => starredCards.has(card.id) ? '#F59E0B' : '#B399D4'}
                                cardGap={(() => {
                                  const availableSpace = sidebarWidth - 188; // sidebar - padding - cardWidth
                                  const maxGap = Math.floor(availableSpace / Math.max(1, sectionCards.length - 1));
                                  return Math.max(1, Math.min(20, maxGap));
                                })()}
                                renderCard={(card, isFront) => (
                                  <div
                                    className={`flashcard stacked ${starredCards.has(card.id) ? 'starred' : ''}`}
                                    style={{
                                      border: 'none',
                                      background: starredCards.has(card.id) ? '#FEF3E2' : '#F9FAFB'
                                    }}
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
                                cardWidth={140}
                                cardHeight={79}
                              />
                            </div>
                          ) : (
                          <div className="flashcard-list">
                          {sectionCards.map((card) => (
                            <div key={card.id}>
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
                                  className={`flashcard ${starredCards.has(card.id) ? 'starred' : ''}`}
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
                          ))}
                          </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </>
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
