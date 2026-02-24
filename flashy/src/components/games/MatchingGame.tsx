import { useState, useEffect, useRef, useCallback } from 'react';
import { Trophy, Clock } from 'lucide-react';

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

interface MatchItem {
  id: string;
  text: string;
  type: 'term' | 'definition';
  cardId: string;
  matched: boolean;
}

export function MatchingGame({ flashcards, onComplete, onBack }: GameProps) {
  const [terms, setTerms] = useState<MatchItem[]>([]);
  const [definitions, setDefinitions] = useState<MatchItem[]>([]);
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
  const [selectedDefinition, setSelectedDefinition] = useState<string | null>(null);
  const [wrongPair, setWrongPair] = useState<{ term: string; def: string } | null>(null);
  const [matchedPairs, setMatchedPairs] = useState<Set<string>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [totalPairs, setTotalPairs] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const initGame = useCallback(() => {
    const count = Math.min(6, Math.max(3, flashcards.length));
    const selected = [...flashcards].sort(() => Math.random() - 0.5).slice(0, count);

    const termItems: MatchItem[] = selected.map(card => ({
      id: `term-${card.id}`,
      text: card.term,
      type: 'term',
      cardId: card.id,
      matched: false,
    }));

    const defItems: MatchItem[] = selected.map(card => ({
      id: `def-${card.id}`,
      text: card.definition,
      type: 'definition',
      cardId: card.id,
      matched: false,
    }));

    // Shuffle both sides independently
    setTerms(termItems.sort(() => Math.random() - 0.5));
    setDefinitions(defItems.sort(() => Math.random() - 0.5));
    setSelectedTerm(null);
    setSelectedDefinition(null);
    setWrongPair(null);
    setMatchedPairs(new Set());
    setMatchCount(0);
    setTotalPairs(count);
    setElapsed(0);
    setIsFinished(false);
  }, [flashcards]);

  useEffect(() => {
    initGame();
  }, [initGame]);

  // Timer
  useEffect(() => {
    if (!isFinished && totalPairs > 0) {
      timerRef.current = setInterval(() => {
        setElapsed(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isFinished, totalPairs]);

  const checkMatch = useCallback((termId: string, defId: string) => {
    const term = terms.find(t => t.id === termId);
    const def = definitions.find(d => d.id === defId);

    if (!term || !def) return;

    if (term.cardId === def.cardId) {
      // Correct match
      const newMatched = new Set(matchedPairs);
      newMatched.add(term.cardId);
      setMatchedPairs(newMatched);
      setMatchCount(prev => prev + 1);
      setSelectedTerm(null);
      setSelectedDefinition(null);

      if (newMatched.size === totalPairs) {
        setIsFinished(true);
        if (timerRef.current) clearInterval(timerRef.current);

        // Save best time
        const key = 'flashy_match_besttime';
        const prev = parseInt(localStorage.getItem(key) || '999999', 10);
        if (elapsed < prev) {
          localStorage.setItem(key, String(elapsed));
        }

        onComplete(totalPairs, totalPairs);
      }
    } else {
      // Wrong match - shake
      setWrongPair({ term: termId, def: defId });
      setTimeout(() => {
        setWrongPair(null);
        setSelectedTerm(null);
        setSelectedDefinition(null);
      }, 600);
    }
  }, [terms, definitions, matchedPairs, totalPairs, elapsed, onComplete]);

  const handleTermClick = useCallback((termId: string) => {
    if (matchedPairs.has(terms.find(t => t.id === termId)?.cardId || '')) return;
    if (wrongPair) return;

    if (selectedTerm === termId) {
      setSelectedTerm(null);
      return;
    }

    setSelectedTerm(termId);

    if (selectedDefinition) {
      checkMatch(termId, selectedDefinition);
    }
  }, [selectedTerm, selectedDefinition, matchedPairs, terms, wrongPair, checkMatch]);

  const handleDefClick = useCallback((defId: string) => {
    if (matchedPairs.has(definitions.find(d => d.id === defId)?.cardId || '')) return;
    if (wrongPair) return;

    if (selectedDefinition === defId) {
      setSelectedDefinition(null);
      return;
    }

    setSelectedDefinition(defId);

    if (selectedTerm) {
      checkMatch(selectedTerm, defId);
    }
  }, [selectedTerm, selectedDefinition, matchedPairs, definitions, wrongPair, checkMatch]);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (isFinished) {
    const bestTime = parseInt(localStorage.getItem('flashy_match_besttime') || '999999', 10);

    return (
      <div className="game-complete-screen">
        <div className="game-complete-icon">
          <Trophy size={64} />
        </div>
        <h2 className="game-complete-title">All Matched!</h2>
        <div className="game-complete-score">{formatTime(elapsed)}</div>
        <div className="game-complete-percentage">{totalPairs} pairs matched</div>
        {bestTime < 999999 && (
          <div className="game-complete-highscore">Best time: {formatTime(bestTime)}</div>
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

  return (
    <div className="match-game">
      <div className="match-header">
        <div className="match-timer">
          <Clock size={18} />
          <span>{formatTime(elapsed)}</span>
        </div>
        <div className="match-progress">
          {matchCount} / {totalPairs} matched
        </div>
      </div>

      <div className="match-grid">
        <div className="match-column">
          <div className="match-column-label">Terms</div>
          {terms.map(item => {
            const isMatched = matchedPairs.has(item.cardId);
            const isSelected = selectedTerm === item.id;
            const isWrong = wrongPair?.term === item.id;

            return (
              <button
                key={item.id}
                className={`match-card ${isMatched ? 'matched' : ''} ${isSelected ? 'selected' : ''} ${isWrong ? 'wrong' : ''}`}
                onClick={() => handleTermClick(item.id)}
                disabled={isMatched}
              >
                <span className="match-card-text">{item.text}</span>
              </button>
            );
          })}
        </div>

        <div className="match-column">
          <div className="match-column-label">Definitions</div>
          {definitions.map(item => {
            const isMatched = matchedPairs.has(item.cardId);
            const isSelected = selectedDefinition === item.id;
            const isWrong = wrongPair?.def === item.id;

            return (
              <button
                key={item.id}
                className={`match-card definition ${isMatched ? 'matched' : ''} ${isSelected ? 'selected' : ''} ${isWrong ? 'wrong' : ''}`}
                onClick={() => handleDefClick(item.id)}
                disabled={isMatched}
              >
                <span className="match-card-text">{item.text}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
