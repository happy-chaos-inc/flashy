import { useState, useEffect, useRef, useCallback } from 'react';
import { Trophy, Flame, Zap } from 'lucide-react';

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

function checkAnswer(userAnswer: string, correctAnswer: string): boolean {
  const normalizedUser = userAnswer.toLowerCase().trim();
  const normalizedCorrect = correctAnswer.toLowerCase().trim();

  // Exact match
  if (normalizedUser === normalizedCorrect) return true;

  // Check if user answer contains the correct answer or vice versa
  if (normalizedCorrect.includes(normalizedUser) && normalizedUser.length >= 3) return true;
  if (normalizedUser.includes(normalizedCorrect)) return true;

  // Jaccard similarity on word arrays
  const userWords = normalizedUser.split(/\s+/).filter(w => w.length > 2);
  const correctWordsArr = normalizedCorrect.split(/\s+/).filter(w => w.length > 2);

  if (correctWordsArr.length === 0) return normalizedUser === normalizedCorrect;

  let matchCount = 0;
  userWords.forEach(word => {
    for (let i = 0; i < correctWordsArr.length; i++) {
      if (correctWordsArr[i].includes(word) || word.includes(correctWordsArr[i])) {
        matchCount++;
        break;
      }
    }
  });

  // Accept if at least 60% of correct answer words are matched
  return matchCount / correctWordsArr.length >= 0.6;
}

export function SpeedRoundGame({ flashcards, onComplete, onBack }: GameProps) {
  const [timeLeft, setTimeLeft] = useState(60);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [shuffledCards, setShuffledCards] = useState<Flashcard[]>([]);
  const [userInput, setUserInput] = useState('');
  const [score, setScore] = useState(0);
  const [totalAttempted, setTotalAttempted] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [combo, setCombo] = useState(1);
  const [isFinished, setIsFinished] = useState(false);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [showCorrectAnswer, setShowCorrectAnswer] = useState('');
  const [isStarted, setIsStarted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const initGame = useCallback(() => {
    const shuffled = [...flashcards].sort(() => Math.random() - 0.5);
    setShuffledCards(shuffled);
    setCurrentCardIndex(0);
    setUserInput('');
    setScore(0);
    setTotalAttempted(0);
    setCorrectCount(0);
    setStreak(0);
    setBestStreak(0);
    setCombo(1);
    setTimeLeft(60);
    setIsFinished(false);
    setFeedback(null);
    setShowCorrectAnswer('');
    setIsStarted(false);
  }, [flashcards]);

  useEffect(() => {
    initGame();
  }, [initGame]);

  // Focus input
  useEffect(() => {
    if (isStarted && !isFinished) {
      inputRef.current?.focus();
    }
  }, [isStarted, isFinished, currentCardIndex]);

  // Timer
  useEffect(() => {
    if (isStarted && !isFinished) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            setIsFinished(true);
            if (timerRef.current) clearInterval(timerRef.current);

            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isStarted, isFinished]);

  // Save high score when finished
  useEffect(() => {
    if (isFinished) {
      const key = 'flashy_speed_highscore';
      const prev = parseInt(localStorage.getItem(key) || '0', 10);
      if (score > prev) {
        localStorage.setItem(key, String(score));
      }
      onComplete(score, totalAttempted);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFinished]);

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userInput.trim() || isFinished || feedback) return;

    const currentCard = shuffledCards[currentCardIndex];
    if (!currentCard) return;

    const isCorrect = checkAnswer(userInput, currentCard.definition);
    setTotalAttempted(prev => prev + 1);

    if (isCorrect) {
      const points = 100 * combo;
      setScore(prev => prev + points);
      setCorrectCount(prev => prev + 1);
      const newStreak = streak + 1;
      setStreak(newStreak);
      setBestStreak(prev => Math.max(prev, newStreak));
      setCombo(Math.min(newStreak + 1, 5)); // Max 5x combo
      setFeedback('correct');
    } else {
      setStreak(0);
      setCombo(1);
      setFeedback('wrong');
      setShowCorrectAnswer(currentCard.definition);
    }

    setTimeout(() => {
      setFeedback(null);
      setShowCorrectAnswer('');
      setUserInput('');
      // Cycle through cards, reshuffling if needed
      if (currentCardIndex >= shuffledCards.length - 1) {
        const reshuffled = [...flashcards].sort(() => Math.random() - 0.5);
        setShuffledCards(reshuffled);
        setCurrentCardIndex(0);
      } else {
        setCurrentCardIndex(prev => prev + 1);
      }
      inputRef.current?.focus();
    }, isCorrect ? 500 : 1200);
  }, [userInput, isFinished, feedback, shuffledCards, currentCardIndex, combo, streak, flashcards]);

  // Start screen
  if (!isStarted) {
    return (
      <div className="speed-start-screen">
        <div className="speed-start-icon">
          <Zap size={64} />
        </div>
        <h2 className="speed-start-title">Speed Round</h2>
        <p className="speed-start-desc">
          You have 60 seconds. Type the definition for each term shown.
          Build combos for bonus points!
        </p>
        <button
          className="game-btn game-btn-primary game-btn-large"
          onClick={() => setIsStarted(true)}
          autoFocus
        >
          Start!
        </button>
      </div>
    );
  }

  if (isFinished) {
    const accuracy = totalAttempted > 0 ? Math.round((correctCount / totalAttempted) * 100) : 0;
    const highScore = parseInt(localStorage.getItem('flashy_speed_highscore') || '0', 10);

    return (
      <div className="game-complete-screen">
        <div className="game-complete-icon">
          <Trophy size={64} />
        </div>
        <h2 className="game-complete-title">Time's Up!</h2>
        <div className="game-complete-score">{score} points</div>
        <div className="speed-stats">
          <div className="speed-stat">
            <span className="speed-stat-value">{correctCount}/{totalAttempted}</span>
            <span className="speed-stat-label">Correct</span>
          </div>
          <div className="speed-stat">
            <span className="speed-stat-value">{accuracy}%</span>
            <span className="speed-stat-label">Accuracy</span>
          </div>
          <div className="speed-stat">
            <span className="speed-stat-value">{bestStreak}</span>
            <span className="speed-stat-label">Best Streak</span>
          </div>
        </div>
        {highScore > 0 && (
          <div className="game-complete-highscore">Best: {highScore} pts</div>
        )}
        <div className="game-complete-actions">
          <button className="game-btn game-btn-primary" onClick={initGame}>
            Play Again
          </button>
          <button className="game-btn game-btn-secondary" onClick={onBack}>
            Back to Games
          </button>
        </div>
      </div>
    );
  }

  const currentCard = shuffledCards[currentCardIndex];
  if (!currentCard) return null;

  return (
    <div className="speed-game">
      <div className="speed-header">
        <div className={`speed-timer ${timeLeft <= 10 ? 'danger' : ''}`}>
          <span className="speed-timer-value">{timeLeft}</span>
          <span className="speed-timer-label">seconds</span>
        </div>
        <div className="speed-score-display">
          <span className="speed-score-value">{score}</span>
          <span className="speed-score-label">points</span>
        </div>
        {combo > 1 && (
          <div className="speed-combo">
            <Flame size={20} />
            <span>{combo}x</span>
          </div>
        )}
      </div>

      <div className={`speed-card ${feedback === 'correct' ? 'correct-flash' : ''} ${feedback === 'wrong' ? 'wrong-flash' : ''}`}>
        <div className="speed-card-label">Term</div>
        <div className="speed-card-term">{currentCard.term}</div>
      </div>

      {showCorrectAnswer && (
        <div className="speed-correct-answer">
          Correct answer: {showCorrectAnswer.length > 100 ? showCorrectAnswer.slice(0, 100) + '...' : showCorrectAnswer}
        </div>
      )}

      <form className="speed-input-area" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="speed-input"
          placeholder="Type the definition..."
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          disabled={feedback !== null}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className="speed-submit-btn"
          disabled={!userInput.trim() || feedback !== null}
        >
          Enter
        </button>
      </form>

      {streak > 1 && (
        <div className="speed-streak">
          <Flame size={16} />
          {streak} streak!
        </div>
      )}
    </div>
  );
}
