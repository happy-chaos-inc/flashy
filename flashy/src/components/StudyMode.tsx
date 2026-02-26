import { useState, useEffect, useCallback } from 'react';
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
  onToggleStar: (cardId: string, event: React.MouseEvent) => void;
  onClose: () => void;
}

export function StudyMode({ flashcards, starredCards, onToggleStar, onClose }: StudyModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);

  const currentCard = flashcards[currentIndex];
  const isStarred = currentCard ? starredCards.has(currentCard.id) : false;

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300);
  }, [onClose]);

  const nextCard = useCallback(() => {
    if (currentIndex < flashcards.length - 1) {
      setIsFlipped(false);
      setSlideDirection('left');
      setTimeout(() => {
        setCurrentIndex(currentIndex + 1);
        setSlideDirection(null);
      }, 300);
    }
  }, [currentIndex, flashcards.length]);

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
          {currentIndex + 1} / {flashcards.length}
        </div>
        <div className="header-controls">
          <button
            className={`study-star-button ${isStarred ? 'starred' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleStar(currentCard.id, e); }}
            title={isStarred ? 'Unstar' : 'Star'}
          >
            <Star size={20} fill={isStarred ? 'currentColor' : 'none'} />
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
