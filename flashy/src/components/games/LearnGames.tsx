import { useState, useEffect, useCallback } from 'react';
import { X, ArrowLeft, Grid3x3, Link2, Timer } from 'lucide-react';
import { MultipleChoiceGame } from './MultipleChoiceGame';
import { MatchingGame } from './MatchingGame';
import { SpeedRoundGame } from './SpeedRoundGame';
import './LearnGames.css';

interface Flashcard {
  id: string;
  term: string;
  definition: string;
  lineNumber: number;
  section?: string;
}

interface LearnGamesProps {
  flashcards: Flashcard[];
  onClose: () => void;
}

type GameType = 'picker' | 'multiple-choice' | 'matching' | 'speed-round';

export function LearnGames({ flashcards, onClose }: LearnGamesProps) {
  const [currentGame, setCurrentGame] = useState<GameType>('picker');
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300);
  }, [onClose]);

  const handleBack = useCallback(() => {
    setCurrentGame('picker');
  }, []);

  const handleComplete = useCallback((_score: number, _total: number) => {
    // Score is already saved in individual games via localStorage
  }, []);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (currentGame !== 'picker') {
          setCurrentGame('picker');
        } else {
          handleClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentGame, handleClose]);

  const hasEnoughForMC = flashcards.length >= 4;
  const hasEnoughForMatch = flashcards.length >= 3;
  const hasEnoughForSpeed = flashcards.length >= 1;

  const renderGame = () => {
    switch (currentGame) {
      case 'multiple-choice':
        return (
          <MultipleChoiceGame
            flashcards={flashcards}
            onComplete={handleComplete}
            onBack={handleBack}
          />
        );
      case 'matching':
        return (
          <MatchingGame
            flashcards={flashcards}
            onComplete={handleComplete}
            onBack={handleBack}
          />
        );
      case 'speed-round':
        return (
          <SpeedRoundGame
            flashcards={flashcards}
            onComplete={handleComplete}
            onBack={handleBack}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className={`learn-games-panel ${isClosing ? 'closing' : ''}`}>
      {/* Header */}
      <div className="learn-games-header">
        {currentGame !== 'picker' && (
          <button className="learn-games-back-btn" onClick={handleBack} title="Back to games">
            <ArrowLeft size={22} />
          </button>
        )}
        <h2 className="learn-games-title">
          {currentGame === 'picker' && 'Learning Games'}
          {currentGame === 'multiple-choice' && 'Multiple Choice'}
          {currentGame === 'matching' && 'Matching'}
          {currentGame === 'speed-round' && 'Speed Round'}
        </h2>
        <button className="learn-games-close-btn" onClick={handleClose} title="Close games">
          <X size={24} />
        </button>
      </div>

      {/* Content */}
      <div className="learn-games-content">
        {currentGame === 'picker' ? (
          <div className="game-picker">
            <div className="game-picker-grid">
              {/* Multiple Choice */}
              <button
                className={`game-picker-card ${!hasEnoughForMC ? 'disabled' : ''}`}
                onClick={() => hasEnoughForMC && setCurrentGame('multiple-choice')}
                disabled={!hasEnoughForMC}
              >
                <div className="game-picker-icon mc-icon">
                  <Grid3x3 size={40} />
                </div>
                <h3 className="game-picker-name">Multiple Choice</h3>
                <p className="game-picker-desc">Pick the right answer</p>
                {!hasEnoughForMC && (
                  <span className="game-picker-requirement">Need 4+ cards</span>
                )}
              </button>

              {/* Matching */}
              <button
                className={`game-picker-card ${!hasEnoughForMatch ? 'disabled' : ''}`}
                onClick={() => hasEnoughForMatch && setCurrentGame('matching')}
                disabled={!hasEnoughForMatch}
              >
                <div className="game-picker-icon match-icon">
                  <Link2 size={40} />
                </div>
                <h3 className="game-picker-name">Matching</h3>
                <p className="game-picker-desc">Match terms to definitions</p>
                {!hasEnoughForMatch && (
                  <span className="game-picker-requirement">Need 3+ cards</span>
                )}
              </button>

              {/* Speed Round */}
              <button
                className={`game-picker-card ${!hasEnoughForSpeed ? 'disabled' : ''}`}
                onClick={() => hasEnoughForSpeed && setCurrentGame('speed-round')}
                disabled={!hasEnoughForSpeed}
              >
                <div className="game-picker-icon speed-icon">
                  <Timer size={40} />
                </div>
                <h3 className="game-picker-name">Speed Round</h3>
                <p className="game-picker-desc">Race against the clock</p>
                {!hasEnoughForSpeed && (
                  <span className="game-picker-requirement">Need 1+ cards</span>
                )}
              </button>
            </div>

            <div className="game-picker-hint">
              <span>Press Esc to close</span>
            </div>
          </div>
        ) : (
          <div className="game-area">
            {renderGame()}
          </div>
        )}
      </div>
    </div>
  );
}
