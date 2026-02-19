import { useState, useEffect, useCallback } from 'react';
import { Check, X as XIcon, Trophy } from 'lucide-react';

interface Flashcard {
  id: string;
  term: string;
  definition: string;
  lineNumber: number;
  section?: string;
}

interface GameProps {
  flashcards: Flashcard[];
  onComplete: (score: number, total: number) => void;
  onBack: () => void;
}

interface Question {
  card: Flashcard;
  mode: 'term' | 'definition';
  choices: string[];
  correctAnswer: string;
}

function generateChoices(cards: Flashcard[], correctCard: Flashcard, mode: 'term' | 'definition'): string[] {
  const wrong = cards
    .filter(c => c.id !== correctCard.id)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map(c => mode === 'term' ? c.term : c.definition);
  const correct = mode === 'term' ? correctCard.term : correctCard.definition;
  return [...wrong, correct].sort(() => Math.random() - 0.5);
}

function generateQuestions(cards: Flashcard[]): Question[] {
  const shuffled = [...cards].sort(() => Math.random() - 0.5);
  const count = Math.min(10, shuffled.length);
  const selected = shuffled.slice(0, count);

  return selected.map(card => {
    const mode: 'term' | 'definition' = Math.random() > 0.5 ? 'term' : 'definition';
    const choices = cards.length >= 4
      ? generateChoices(cards, card, mode)
      : [mode === 'term' ? card.term : card.definition]; // fallback
    const correctAnswer = mode === 'term' ? card.term : card.definition;
    return { card, mode, choices, correctAnswer };
  });
}

export function MultipleChoiceGame({ flashcards, onComplete, onBack }: GameProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [results, setResults] = useState<('correct' | 'wrong' | null)[]>([]);
  const [score, setScore] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const q = generateQuestions(flashcards);
    setQuestions(q);
    setResults(new Array(q.length).fill(null));
  }, [flashcards]);

  const handleSelect = useCallback((answer: string) => {
    if (selectedAnswer !== null || isTransitioning) return;

    setSelectedAnswer(answer);
    const isCorrect = answer === questions[currentIndex].correctAnswer;

    const newResults = [...results];
    newResults[currentIndex] = isCorrect ? 'correct' : 'wrong';
    setResults(newResults);

    if (isCorrect) {
      setScore(prev => prev + 1);
    }

    setIsTransitioning(true);
    setTimeout(() => {
      if (currentIndex < questions.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setSelectedAnswer(null);
        setIsTransitioning(false);
      } else {
        setIsFinished(true);
        const finalScore = isCorrect ? score + 1 : score;

        // Save high score
        const key = 'flashy_mc_highscore';
        const prev = parseInt(localStorage.getItem(key) || '0', 10);
        if (finalScore > prev) {
          localStorage.setItem(key, String(finalScore));
        }

        onComplete(finalScore, questions.length);
      }
    }, 1500);
  }, [selectedAnswer, isTransitioning, questions, currentIndex, results, score, onComplete]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isFinished || selectedAnswer !== null) return;
      if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') {
        const idx = parseInt(e.key) - 1;
        if (idx < questions[currentIndex]?.choices.length) {
          handleSelect(questions[currentIndex].choices[idx]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFinished, selectedAnswer, questions, currentIndex, handleSelect]);

  if (questions.length === 0) return null;

  if (isFinished) {
    const percentage = Math.round((score / questions.length) * 100);
    const highScore = parseInt(localStorage.getItem('flashy_mc_highscore') || '0', 10);

    return (
      <div className="game-complete-screen">
        <div className="game-complete-icon">
          <Trophy size={64} />
        </div>
        <h2 className="game-complete-title">
          {percentage >= 80 ? 'Excellent!' : percentage >= 60 ? 'Good job!' : 'Keep practicing!'}
        </h2>
        <div className="game-complete-score">{score} / {questions.length}</div>
        <div className="game-complete-percentage">{percentage}% correct</div>
        {highScore > 0 && (
          <div className="game-complete-highscore">Best: {highScore}/{questions.length}</div>
        )}
        <div className="game-complete-actions">
          <button className="game-btn game-btn-primary" onClick={() => {
            const q = generateQuestions(flashcards);
            setQuestions(q);
            setResults(new Array(q.length).fill(null));
            setCurrentIndex(0);
            setSelectedAnswer(null);
            setScore(0);
            setIsFinished(false);
            setIsTransitioning(false);
          }}>
            Play Again
          </button>
          <button className="game-btn game-btn-secondary" onClick={onBack}>
            Back to Games
          </button>
        </div>
      </div>
    );
  }

  const question = questions[currentIndex];
  const prompt = question.mode === 'term'
    ? question.card.definition
    : question.card.term;
  const promptLabel = question.mode === 'term'
    ? 'Select the correct term'
    : 'Select the correct definition';

  return (
    <div className="mc-game">
      {/* Progress dots */}
      <div className="mc-progress">
        {questions.map((_, i) => (
          <div
            key={i}
            className={`mc-progress-dot ${
              results[i] === 'correct' ? 'correct' :
              results[i] === 'wrong' ? 'wrong' :
              i === currentIndex ? 'current' : ''
            }`}
          />
        ))}
      </div>

      <div className="mc-question-number">
        Question {currentIndex + 1} of {questions.length}
      </div>

      {/* Prompt */}
      <div className="mc-prompt">
        <div className="mc-prompt-text">{prompt}</div>
      </div>

      <div className="mc-prompt-label">{promptLabel}</div>

      {/* Choices */}
      <div className="mc-choices">
        {question.choices.map((choice, i) => {
          const isSelected = selectedAnswer === choice;
          const isCorrect = choice === question.correctAnswer;
          const showResult = selectedAnswer !== null;

          let className = 'mc-choice';
          if (showResult && isCorrect) className += ' correct';
          if (showResult && isSelected && !isCorrect) className += ' wrong';
          if (!showResult) className += ' selectable';

          return (
            <button
              key={i}
              className={className}
              onClick={() => handleSelect(choice)}
              disabled={selectedAnswer !== null}
            >
              <span className="mc-choice-number">{i + 1}</span>
              <span className="mc-choice-text">{choice}</span>
              {showResult && isCorrect && (
                <span className="mc-choice-icon correct">
                  <Check size={20} />
                </span>
              )}
              {showResult && isSelected && !isCorrect && (
                <span className="mc-choice-icon wrong">
                  <XIcon size={20} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mc-keyboard-hint">
        Press 1-4 to select
      </div>
    </div>
  );
}
