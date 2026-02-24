import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very',
  'just', 'because', 'if', 'when', 'where', 'how', 'what', 'which', 'who',
  'whom', 'this', 'that', 'these', 'those', 'it', 'its', 'also', 'about',
  'up', 'like', 'them', 'they', 'their', 'there', 'here', 'we', 'us',
  'our', 'he', 'she', 'him', 'her', 'his', 'i', 'me', 'my', 'you', 'your',
]);

function extractKeywords(definition: string): string[] {
  const words = definition.split(/\s+/);
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const raw of words) {
    const word = raw.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
    const lower = word.toLowerCase();
    if (word.length >= 3 && !STOP_WORDS.has(lower) && !seen.has(lower)) {
      seen.add(lower);
      keywords.push(word);
    }
  }

  // Cap at 8 — pick evenly spaced if too many
  if (keywords.length > 8) {
    const step = keywords.length / 8;
    const picked: string[] = [];
    for (let i = 0; i < 8; i++) {
      picked.push(keywords[Math.round(i * step)]);
    }
    return picked;
  }

  return keywords;
}

function wordMatchesKeyword(typed: string, keyword: string): boolean {
  const a = typed.toLowerCase();
  const b = keyword.toLowerCase();
  if (a === b) return true;
  // Allow 1 char off for words 5+ chars
  if (b.length >= 5 && Math.abs(a.length - b.length) <= 1) {
    let diffs = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) diffs++;
      if (diffs > 1) return false;
    }
    return true;
  }
  return false;
}

function getMatchedKeywords(input: string, keywords: string[]): Set<number> {
  const typedWords = input.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  const matched = new Set<number>();
  for (const typed of typedWords) {
    for (let i = 0; i < keywords.length; i++) {
      if (!matched.has(i) && wordMatchesKeyword(typed, keywords[i])) {
        matched.add(i);
        break;
      }
    }
  }
  return matched;
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
  const [missedKeywords, setMissedKeywords] = useState<string[]>([]);
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
    setMissedKeywords([]);
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

  const currentCard = shuffledCards[currentCardIndex];
  const keywords = useMemo(
    () => currentCard ? extractKeywords(currentCard.definition) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentCard?.id]
  );

  // Live tracking — keywords light up as the user types
  const liveMatched = useMemo(
    () => getMatchedKeywords(userInput, keywords),
    [userInput, keywords]
  );

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!userInput.trim() || isFinished || feedback) return;
    if (!currentCard || keywords.length === 0) return;

    const matched = getMatchedKeywords(userInput, keywords);
    const ratio = matched.size / keywords.length;

    setTotalAttempted(prev => prev + 1);

    // Pass if they hit at least half the keywords
    const isCorrect = ratio >= 0.5;

    if (isCorrect) {
      const points = 100 * combo;
      setScore(prev => prev + points);
      setCorrectCount(prev => prev + 1);
      const newStreak = streak + 1;
      setStreak(newStreak);
      setBestStreak(prev => Math.max(prev, newStreak));
      setCombo(Math.min(newStreak + 1, 5));
      setFeedback('correct');
      setMissedKeywords([]);
    } else {
      setStreak(0);
      setCombo(1);
      setFeedback('wrong');
      setMissedKeywords(keywords.filter((_, i) => !matched.has(i)));
    }

    setTimeout(() => {
      setFeedback(null);
      setMissedKeywords([]);
      setUserInput('');
      if (currentCardIndex >= shuffledCards.length - 1) {
        const reshuffled = [...flashcards].sort(() => Math.random() - 0.5);
        setShuffledCards(reshuffled);
        setCurrentCardIndex(0);
      } else {
        setCurrentCardIndex(prev => prev + 1);
      }
      inputRef.current?.focus();
    }, isCorrect ? 500 : 1500);
  }, [userInput, isFinished, feedback, currentCard, keywords, shuffledCards, currentCardIndex, combo, streak, flashcards]);

  // Start screen
  if (!isStarted) {
    return (
      <div className="speed-start-screen">
        <div className="speed-start-icon">
          <Zap size={64} />
        </div>
        <h2 className="speed-start-title">Speed Round</h2>
        <p className="speed-start-desc">
          You have 60 seconds. Type what you remember about each definition
          &mdash; hit the keywords to score! Build combos for bonus points.
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

      {/* Keyword pills — light up green as user types matching words */}
      <div className="speed-keywords">
        <div className="speed-keywords-label">Hit the keywords</div>
        <div className="speed-keywords-chips">
          {keywords.map((kw, i) => (
            <span key={i} className={`speed-keyword-chip ${liveMatched.has(i) ? 'hit' : ''}`}>
              {kw}
            </span>
          ))}
        </div>
      </div>

      {missedKeywords.length > 0 && (
        <div className="speed-correct-answer">
          Missed: {missedKeywords.join(', ')}
        </div>
      )}

      <form className="speed-input-area" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="speed-input"
          placeholder="Type what you remember..."
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
