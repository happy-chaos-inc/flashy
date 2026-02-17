import { useAuth } from '../hooks/useAuth';
import { MarkdownEditor } from '../components/editor/MarkdownEditor';
import { TiptapEditor } from '../components/editor/TiptapEditor';
import { VersionHistory } from '../components/editor/VersionHistory';
import { OnlineUsers } from '../components/editor/OnlineUsers';
import { MouseCursors } from '../components/editor/MouseCursors';
import { Logo } from '../components/Logo';
import { StudyMode } from '../components/StudyMode';
import { ModeSelector, EditorMode } from '../components/editor/ModeSelector';
import { collaborationManager } from '../lib/CollaborationManager';
import { prosemirrorToMarkdown } from '../lib/prosemirrorToMarkdown';
import { useEffect, useState, useRef } from 'react';
import { Star, LogOut, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Play, Edit2, Info } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import './EditorPage.css';
import packageJson from '../../package.json';
const version = packageJson.version;

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
  const MARGIN_GAP = 16;

  const { logout } = useAuth();
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showStudyMode, setShowStudyMode] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
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
  const hasInitializedSections = useRef(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    const saved = localStorage.getItem('flashy_editor_mode');
    return (saved as EditorMode) || 'markdown';
  });

  const handleLogout = () => {
    logout();
    // No navigation - auth state change will trigger re-render
  };

  const handleModeChange = async (mode: EditorMode) => {
    // No sync needed - Y.XmlFragment is the only source of truth
    // Both editors read/write to Y.XmlFragment
    setEditorMode(mode);
    localStorage.setItem('flashy_editor_mode', mode);

    // Broadcast mode change via awareness
    try {
      const { provider } = await collaborationManager.connect();
      provider.awareness.setLocalStateField('editorMode', mode);
    } catch (error) {
      console.error('Failed to broadcast mode change:', error);
    }
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
  const handleMouseDown = (e: React.MouseEvent) => {
    setDragStartX(e.clientX);
    setIsDragging(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || dragStartX === null) return;

      // Only start dragging if moved more than 3 pixels
      const dragDistance = Math.abs(e.clientX - dragStartX);
      if (dragDistance < 3) return;

      const newWidth = window.innerWidth - e.clientX;
      // Ensure sidebar is at least MIN_PANEL_WIDTH AND editor maintains MIN_PANEL_WIDTH
      // Account for: left margin + editor min width + gap + right margin
      const maxWidth = window.innerWidth - (MARGIN_LEFT + MIN_PANEL_WIDTH + MARGIN_GAP + MARGIN_LEFT);
      if (newWidth >= MIN_PANEL_WIDTH && newWidth <= maxWidth) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDragStartX(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, dragStartX]);

  // Collapse all sections by default on first load
  useEffect(() => {
    if (!hasInitializedSections.current && flashcards.length > 0) {
      const allSections = new Set(flashcards.map(card => card.section || 'Unsorted'));
      setCollapsedSections(allSections);
      hasInitializedSections.current = true;
    }
  }, [flashcards]);

  // Keyboard shortcut for mode switching (Ctrl/Cmd + Shift + M)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        const newMode = editorMode === 'wysiwyg' ? 'markdown' : 'wysiwyg';
        handleModeChange(newMode);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editorMode]);

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
        const { ydoc, provider } = await collaborationManager.connect();

        // Broadcast initial editor mode
        provider.awareness.setLocalStateField('editorMode', editorMode);

        // Y.XmlFragment is the ONLY source of truth
        const yXmlFragment = ydoc.getXmlFragment('prosemirror');

        // Serialize Y.XmlFragment to markdown for flashcard parsing
        const getContent = (): string => {
          return prosemirrorToMarkdown(yXmlFragment);
        };

        // Initial parse
        const initialCards = parseFlashcards(getContent());
        setFlashcards(initialCards);

        // Listen for Y.XmlFragment changes (both modes)
        const yXmlObserver = () => {
          const content = prosemirrorToMarkdown(yXmlFragment);
          const cards = parseFlashcards(content);
          setFlashcards(cards);
        };

        yXmlFragment.observeDeep(yXmlObserver);

        return () => {
          yXmlFragment.unobserveDeep(yXmlObserver);
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
  }, [editorMode]);

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
      '--min-panel-width': `${MIN_PANEL_WIDTH}px`,
      '--margin-left': `${MARGIN_LEFT}px`,
      '--margin-gap': `${MARGIN_GAP}px`
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
        <div className="mode-selector-overlay">
          <ModeSelector currentMode={editorMode} onModeChange={handleModeChange} />
        </div>
        {editorMode === 'wysiwyg' ? <TiptapEditor /> : <MarkdownEditor />}
      </div>

      <div
        className={`resize-handle ${isAnimating ? 'animating' : ''}`}
        style={{ right: `calc(var(--sidebar-width) + var(--margin-left) + var(--margin-gap) / 2 - 24px)` }}
        onMouseDown={handleMouseDown}
      >
        <div
          className={`resize-stick ${isAnimating ? 'animating' : ''}`}
        />
        <button
          className={`resize-toggle-button ${isAnimating ? 'animating' : ''}`}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            const maxWidth = window.innerWidth - (MARGIN_LEFT + MIN_PANEL_WIDTH + MARGIN_GAP + MARGIN_LEFT);
            setIsAnimating(true);
            if (sidebarWidth >= maxWidth - 5) {
              // At max, toggle to min
              setSidebarWidth(MIN_PANEL_WIDTH);
            } else {
              // Otherwise, go to max
              setSidebarWidth(maxWidth);
            }
            setTimeout(() => setIsAnimating(false), 500);
          }}
          title="Toggle sidebar"
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg
              width={32}
              height={32}
              viewBox="0 0 55 55"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g transform="translate(-30, -13) scale(4) rotate(-15)">
                <path d="
                  M10 16.7
                  L13 18.5
                  C13.8321 19.1154 14.9154 18.8615 15.2857 18.0313L18.2815 11.4698C18.6518 10.6396 18.1606 9.67891 17.2518 9.53429L8.3871 8.16507
                  C7 8.02045 6.71766 8.79742 6.34815 9.68484
                  L5.6 11.5
                  C4.5 13.9 5 13.7 8 15.5
                  z
                " fill="#B399D4" stroke="#B399D4" strokeWidth="1.25"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </g>
            </svg>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'white' }}>
              {(() => {
                const maxWidth = window.innerWidth - (MARGIN_LEFT + MIN_PANEL_WIDTH + MARGIN_GAP + MARGIN_LEFT);
                if (sidebarWidth >= maxWidth - 5) {
                  return <ChevronRight size={14} />;
                } else {
                  return <ChevronLeft size={14} />;
                }
              })()}
            </div>
          </div>
        </button>
      </div>

      {/* Sidebar rendered with fixed positioning */}
      <div className={`flashcard-sidebar ${isAnimating ? 'animating' : ''}`}>
          <div className="flashcard-header">
            <div className="flashcard-title-row">
              <h3>Flashcards</h3>
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
                     <span>made with dreams :)</span>
                      <br></br>
                      <span><u>v{version}</u></span>
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
                      const starredCount = sectionCards.filter(card => starredCards.has(card.id)).length;
                      const sectionHasStarred = starredCount > 0;
                      return (
                        <div key={sectionName} className="flashcard-section-group">
                          <div
                            className="flashcard-section"
                            onClick={() => toggleSectionCollapse(sectionName)}
                          >
                            <span className="section-collapse-icon">
                              {isCollapsed ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
                            </span>
                            <span className="section-name">{sectionName}</span>
                            {isCollapsed && (
                              <>
                                {sectionHasStarred && (
                                  <span className="section-starred">
                                    <Star size={24} fill="#F59E0B" color="#F59E0B" />
                                    <span className="section-starred-count">{starredCount}</span>
                                  </span>
                                )}
                                <span className="section-badge">{sectionCards.length}</span>
                              </>
                            )}
                          </div>
                          {!isCollapsed && (
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
                                      <div className="flashcard-definition">
                                        <ReactMarkdown>{card.definition}</ReactMarkdown>
                                      </div>
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
