import { useState, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Star, X } from 'lucide-react';
import './StudyMode.css';

interface Flashcard {
  id: string;
  term: string;
  definition: string;
  lineNumber: number;
}

interface StudyModeProps {
  flashcards: Flashcard[];
  starredCards: Set<string>;
  onClose: () => void;
}

export function StudyMode({ flashcards, starredCards, onClose }: StudyModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);

  // Filter flashcards based on starred-only mode
  const filteredCards = useMemo(() => {
    if (starredOnly) {
      return flashcards.filter(card => starredCards.has(card.id));
    }
    return flashcards;
  }, [flashcards, starredCards, starredOnly]);

  const currentCard = filteredCards[currentIndex];

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300);
  }, [onClose]);

  const nextCard = useCallback(() => {
    if (currentIndex < filteredCards.length - 1) {
      setIsFlipped(false);
      setSlideDirection('left');
      setTimeout(() => {
        setCurrentIndex(currentIndex + 1);
        setSlideDirection(null);
      }, 300);
    }
  }, [currentIndex, filteredCards.length]);

  const prevCard = useCallback(() => {
    if (currentIndex > 0) {
      setIsFlipped(false);
      setSlideDirection('right');
      setTimeout(() => {
        setCurrentIndex(currentIndex - 1);
        setSlideDirection(null);
      }, 300);
    }
  }, [currentIndex]);

  // Reset to first card when toggling starred-only mode
  const toggleStarredOnly = () => {
    setStarredOnly(!starredOnly);
    setCurrentIndex(0);
    setIsFlipped(false);
  };

  const toggleFlip = useCallback(() => {
    setIsFlipped(!isFlipped);
  }, [isFlipped]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        toggleFlip();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextCard();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevCard();
      } else if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, nextCard, prevCard, toggleFlip]);

  return (
    <div className={`study-mode-panel ${isClosing ? 'closing' : ''}`}>
      <div className="study-mode-header">
        <div className="study-progress">
          {currentIndex + 1} / {filteredCards.length}
          {starredOnly && <span className="starred-badge"> ★ Starred</span>}
        </div>
        <div className="header-controls">
          <button
            className={`starred-filter-button ${starredOnly ? 'active' : ''}`}
            onClick={toggleStarredOnly}
            title="Study starred only"
            disabled={starredCards.size === 0}
          >
            <Star size={20} fill={starredOnly ? 'currentColor' : 'none'} />
          </button>
          <button
            className="close-button"
            onClick={handleClose}
            title="Close study mode"
          >
            <X size={28} />
          </button>
        </div>
      </div>

      <div className="study-card-container">
        <div
          className={`study-card ${isFlipped ? 'flipped' : ''} ${slideDirection ? `slide-${slideDirection}` : ''}`}
          onClick={toggleFlip}
        >
          <div className="study-card-front">
            <div className="card-label">Term</div>
            <div className="card-content">{currentCard.term}</div>
          </div>
          <div className="study-card-back">
            <div className="card-label">Definition</div>
            <div className="card-content card-content-markdown">
              <ReactMarkdown>{currentCard.definition}</ReactMarkdown>
            </div>
          </div>
        </div>
      </div>

      <div className="keyboard-shortcuts">
        <span>Space/↑↓: Flip</span>
        <span>← →: Navigate</span>
        <span>Esc: Exit</span>
      </div>
    </div>
  );
}
