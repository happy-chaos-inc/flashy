import { useState, useRef, useEffect } from 'react';
import { Star, ChevronLeft, ChevronDown, ChevronUp, Play, Edit2, GraduationCap, Gamepad2, ScrollText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export interface Flashcard {
  id: string;
  term: string;
  definition: string;
  lineNumber: number;
  section?: string;
}

interface FlashcardSidebarProps {
  flashcards: Flashcard[];
  starredCards: Set<string>;
  onToggleStar: (cardId: string, event: React.MouseEvent) => void;
  onStartStudy: (cardIds?: string[]) => void;
  onStartTutor: (cardIds?: string[]) => void;
  onStartGames?: (cardIds?: string[]) => void;
  isAnimating?: boolean;
  tutorInstructions?: string;
  onTutorInstructionsChange?: (value: string) => void;
}

export function FlashcardSidebar({
  flashcards,
  starredCards,
  onToggleStar,
  onStartStudy,
  onStartTutor,
  onStartGames,
  isAnimating = false,
  tutorInstructions = '',
  onTutorInstructionsChange,
}: FlashcardSidebarProps) {
  // Internal state for sidebar UI
  const [previewCardIds, setPreviewCardIds] = useState<Set<string>>(new Set());
  const [flippedCardIds, setFlippedCardIds] = useState<Set<string>>(new Set());
  const [showOnlyStarred, setShowOnlyStarred] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const configBtnRef = useRef<HTMLButtonElement>(null);
  const hasInitializedSections = useRef(false);

  // Close menu dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  // Collapse all sections by default on first load
  useEffect(() => {
    if (!hasInitializedSections.current && flashcards.length > 0) {
      const allSections = new Set(flashcards.map(card => card.section || 'Unsorted'));
      setCollapsedSections(allSections);
      hasInitializedSections.current = true;
    }
  }, [flashcards]);

  // Handle flashcard click - expand card in place
  const handleFlashcardClick = (card: Flashcard) => {
    const newPreviewIds = new Set(previewCardIds);
    if (newPreviewIds.has(card.id)) {
      newPreviewIds.delete(card.id);
      const newFlippedIds = new Set(flippedCardIds);
      newFlippedIds.delete(card.id);
      setFlippedCardIds(newFlippedIds);
    } else {
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

  const toggleSectionCollapse = (sectionName: string) => {
    const newCollapsed = new Set(collapsedSections);
    if (newCollapsed.has(sectionName)) {
      newCollapsed.delete(sectionName);
    } else {
      newCollapsed.add(sectionName);
    }
    setCollapsedSections(newCollapsed);
  };

  const toggleSectionSelection = (sectionName: string) => {
    const newSelected = new Set(selectedSections);
    if (newSelected.has(sectionName)) {
      newSelected.delete(sectionName);
    } else {
      newSelected.add(sectionName);
    }
    setSelectedSections(newSelected);
  };

  const filteredCards = showOnlyStarred
    ? flashcards.filter(card => starredCards.has(card.id))
    : flashcards;

  // Group cards by section
  const sections: { [key: string]: Flashcard[] } = {};
  filteredCards.forEach(card => {
    const sectionName = card.section || 'Unsorted';
    if (!sections[sectionName]) {
      sections[sectionName] = [];
    }
    sections[sectionName].push(card);
  });

  // Get cards from selected sections (or all if none selected)
  const getSelectedCardIds = (): string[] => {
    if (selectedSections.size === 0) {
      return filteredCards.map(card => card.id);
    }
    return filteredCards
      .filter(card => selectedSections.has(card.section || 'Unsorted'))
      .map(card => card.id);
  };

  return (
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
              onClick={() => onStartStudy(getSelectedCardIds())}
              title={selectedSections.size > 0 ? `Study ${selectedSections.size} selected section(s)` : "Study all cards"}
            >
              <Play size={20} fill="currentColor" />
              Learn{selectedSections.size > 0 ? ` (${selectedSections.size})` : ''}
            </button>
            <div ref={menuRef} className="tutor-button-group">
              <button
                className="study-button tutor-button"
                onClick={() => onStartTutor(getSelectedCardIds())}
                title={selectedSections.size > 0 ? `Quiz on ${selectedSections.size} selected section(s)` : "Quiz on all cards"}
              >
                <GraduationCap size={20} />
                Tutor
              </button>
              <button
                ref={configBtnRef}
                className={`tutor-config-button ${showMenu ? 'active' : ''}`}
                onClick={() => {
                  if (!showMenu && configBtnRef.current) {
                    const rect = configBtnRef.current.getBoundingClientRect();
                    setMenuPos({ top: rect.bottom + 8, left: rect.right - 280 });
                  }
                  setShowMenu(!showMenu);
                }}
                title="Sample questions for tutor"
              >
                <ScrollText size={14} />
              </button>
              {showMenu && menuPos && (
                <div
                  className="sidebar-menu-dropdown"
                  style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
                >
                  <label className="sidebar-menu-label">Sample Questions for Tutor</label>
                  <textarea
                    className="tutor-instructions-textarea"
                    value={tutorInstructions}
                    onChange={(e) => onTutorInstructionsChange?.(e.target.value)}
                    placeholder={"Add sample questions to guide the tutor...\n\nExamples:\n- Compare and contrast X and Y\n- Give a real-world example of...\n- What are the 3 key principles of..."}
                    rows={6}
                  />
                </div>
              )}
            </div>
            {onStartGames && (
              <button className="toolbar-icon-button" onClick={() => onStartGames(getSelectedCardIds())} title="Learning games">
                <Gamepad2 size={20} />
              </button>
            )}
            <button
              className={`toolbar-icon-button ${showOnlyStarred ? 'active' : ''}`}
              onClick={() => setShowOnlyStarred(!showOnlyStarred)}
              title={showOnlyStarred ? "Show all cards" : "Show starred only"}
            >
              <Star size={20} fill={showOnlyStarred ? "currentColor" : "none"} />
            </button>
          </div>
        )}
      </div>

      {flashcards.length === 0 ? (
        <p className="sidebar-placeholder">
          Use ## headings in the editor to create flashcards
        </p>
      ) : showOnlyStarred && filteredCards.length === 0 ? (
        <p className="sidebar-placeholder">
          No starred cards yet. Click the star icon on a card to add it to your favorites!
        </p>
      ) : (
        <>
          {Object.entries(sections).map(([sectionName, sectionCards]) => {
            const isCollapsed = collapsedSections.has(sectionName);
            const starredCount = sectionCards.filter(card => starredCards.has(card.id)).length;
            const sectionHasStarred = starredCount > 0;

            return (
              <div key={sectionName} className="flashcard-section-group">
                <div
                  className={`flashcard-section ${selectedSections.has(sectionName) ? 'selected' : ''}`}
                  onClick={() => toggleSectionSelection(sectionName)}
                >
                  <span className="section-name">{sectionName}</span>
                  {sectionHasStarred && (
                    <span className="section-starred">
                      <Star size={14} fill="#F59E0B" color="#F59E0B" />
                      <span className="section-starred-count">{starredCount}</span>
                    </span>
                  )}
                  <button
                    className={`section-card-count ${isCollapsed ? 'collapsed' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSectionCollapse(sectionName);
                    }}
                    title={isCollapsed ? `Show ${sectionCards.length} cards` : "Hide cards"}
                  >
                    {sectionCards.length}
                    {isCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="flashcard-list">
                    {sectionCards.map((card) => (
                      <div key={card.id}>
                        {previewCardIds.has(card.id) ? (
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
                                    onClick={(e) => onToggleStar(card.id, e)}
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
          })}
        </>
      )}
    </div>
  );
}
