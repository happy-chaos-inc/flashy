import { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { X, Trophy, Flame, ArrowRight, CheckCircle, XCircle, Target, Loader2, RotateCcw } from 'lucide-react';
import { supabase } from '../config/supabase';
import { Flashcard } from './FlashcardSidebar';
import './TutorMode.css';

interface TutorQuestion {
  id: string;
  type: 'define' | 'identify' | 'truefalse' | 'fillin';
  question: string;
  detail?: string; // Rich markdown content shown below the question prompt
  correctAnswer: string;
  flashcardId: string;
  section?: string;
}

interface HistoryEntry {
  question: TutorQuestion;
  userAnswer: string;
  correct: boolean;
  explanation: string;
}

interface TutorSession {
  score: number;
  total: number;
  streak: number;
  bestStreak: number;
  wrongCards: Set<string>;
  history: HistoryEntry[];
}

interface TutorModeProps {
  flashcards: Flashcard[];
  onClose: () => void;
  roomId: string;
  tutorInstructions?: string;
}

// Best score storage
function getBestScore(roomId: string): { score: number; total: number } | null {
  try {
    const saved = localStorage.getItem(`tutor_best_${roomId}`);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function saveBestScore(roomId: string, score: number, total: number) {
  const current = getBestScore(roomId);
  const currentPct = current ? current.score / current.total : 0;
  const newPct = total > 0 ? score / total : 0;
  if (!current || newPct > currentPct) {
    localStorage.setItem(`tutor_best_${roomId}`, JSON.stringify({ score, total }));
  }
}

// Shuffle array in place (Fisher-Yates)
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pick a random wrong definition from a different card
function pickWrongDefinition(cards: Flashcard[], excludeId: string): string {
  const others = cards.filter(c => c.id !== excludeId);
  if (others.length === 0) return 'No definition available';
  return others[Math.floor(Math.random() * others.length)].definition;
}

// Replace a key word in the definition with ___
function createFillInBlank(definition: string): { blanked: string; answer: string } | null {
  // Split into words, pick a substantial word (>3 chars) to blank out
  const words = definition.split(/\s+/);
  const candidates = words.filter(w => w.replace(/[^a-zA-Z]/g, '').length > 3);
  if (candidates.length === 0) return null;
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const cleanTarget = target.replace(/[^a-zA-Z]/g, '');
  const blanked = definition.replace(target, '___');
  return { blanked, answer: cleanTarget };
}

function generateQuestions(flashcards: Flashcard[]): TutorQuestion[] {
  const questions: TutorQuestion[] = [];
  const shuffled = shuffle(flashcards);

  shuffled.forEach((card, idx) => {
    const types: TutorQuestion['type'][] = ['define', 'identify', 'truefalse', 'fillin'];
    // Pick a type based on index to get a good mix
    const type = types[idx % types.length];

    switch (type) {
      case 'define':
        questions.push({
          id: `q-${idx}-define`,
          type: 'define',
          question: `Define: ${card.term}`,
          correctAnswer: card.definition,
          flashcardId: card.id,
          section: card.section,
        });
        break;

      case 'identify':
        questions.push({
          id: `q-${idx}-identify`,
          type: 'identify',
          question: 'Which term is described by:',
          detail: card.definition,
          correctAnswer: card.term,
          flashcardId: card.id,
          section: card.section,
        });
        break;

      case 'truefalse': {
        const isTrue = Math.random() > 0.5;
        const shownDef = isTrue
          ? card.definition
          : pickWrongDefinition(flashcards, card.id);
        questions.push({
          id: `q-${idx}-tf`,
          type: 'truefalse',
          question: `True or False: "${card.term}" means:`,
          detail: shownDef,
          correctAnswer: isTrue ? 'True' : 'False',
          flashcardId: card.id,
          section: card.section,
        });
        break;
      }

      case 'fillin': {
        const result = createFillInBlank(card.definition);
        if (result) {
          questions.push({
            id: `q-${idx}-fillin`,
            type: 'fillin',
            question: `Fill in the blank for "${card.term}":`,
            detail: result.blanked,
            correctAnswer: result.answer,
            flashcardId: card.id,
            section: card.section,
          });
        } else {
          // Fallback to define
          questions.push({
            id: `q-${idx}-define-fallback`,
            type: 'define',
            question: `Define: ${card.term}`,
            correctAnswer: card.definition,
            flashcardId: card.id,
            section: card.section,
          });
        }
        break;
      }
    }
  });

  return shuffle(questions);
}

const ENCOURAGING_MESSAGES = [
  'Great job!',
  'Nailed it!',
  'You got this!',
  'Excellent!',
  'Keep it up!',
  'Well done!',
  'Impressive!',
  'On fire!',
];

const MISS_MESSAGES = [
  'Not quite, but you are learning!',
  'Almost there! Keep going.',
  'Good effort! Review this one.',
  'No worries, you will get it next time!',
  'Learning is a process. Keep at it!',
];

function getEncouragingMessage(): string {
  return ENCOURAGING_MESSAGES[Math.floor(Math.random() * ENCOURAGING_MESSAGES.length)];
}

function getMissMessage(): string {
  return MISS_MESSAGES[Math.floor(Math.random() * MISS_MESSAGES.length)];
}

export function TutorMode({ flashcards, onClose, roomId, tutorInstructions }: TutorModeProps) {
  const [questions, setQuestions] = useState<TutorQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [session, setSession] = useState<TutorSession>({
    score: 0,
    total: 0,
    streak: 0,
    bestStreak: 0,
    wrongCards: new Set(),
    history: [],
  });
  const [feedback, setFeedback] = useState<{ correct: boolean; explanation: string } | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoAdvanceRef = useRef<NodeJS.Timeout | null>(null);

  // Generate questions on mount
  useEffect(() => {
    if (flashcards.length >= 4) {
      setQuestions(generateQuestions(flashcards));
    }
  }, [flashcards]);

  // Focus input when question changes
  useEffect(() => {
    if (!feedback && !showSummary) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [currentIndex, feedback, showSummary]);

  // Cleanup auto-advance timer
  useEffect(() => {
    return () => {
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    };
  }, []);

  const handleClose = useCallback(() => {
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    setIsClosing(true);
    setTimeout(() => onClose(), 300);
  }, [onClose]);

  // Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  const currentQuestion = questions[currentIndex];
  const progressPct = questions.length > 0 ? ((currentIndex) / questions.length) * 100 : 0;

  const evaluateAnswer = async () => {
    if (!userAnswer.trim() || !currentQuestion || isEvaluating) return;

    setIsEvaluating(true);

    try {
      // For true/false, evaluate locally
      if (currentQuestion.type === 'truefalse') {
        const normalized = userAnswer.trim().toLowerCase();
        const correct = (normalized === 'true' || normalized === 't' || normalized === 'yes')
          ? currentQuestion.correctAnswer === 'True'
          : (normalized === 'false' || normalized === 'f' || normalized === 'no')
            ? currentQuestion.correctAnswer === 'False'
            : false;

        const explanation = correct
          ? `Correct! The answer is ${currentQuestion.correctAnswer}.`
          : `The correct answer is ${currentQuestion.correctAnswer}.`;

        applyFeedback(correct, explanation);
        return;
      }

      // Use AI to evaluate
      const instructionsContext = tutorInstructions?.trim()
        ? `\n\nThe instructor has provided these sample question styles:\n${tutorInstructions}\n\nGrade the student's answer with these question styles in mind.`
        : '';
      const systemPrompt = `You are evaluating a student's answer to a flashcard question. Be lenient - accept answers that capture the key concept even if not word-for-word. For "identify" type questions, accept reasonable variations of the term name.

The question type is: ${currentQuestion.type}
The correct answer is: ${currentQuestion.correctAnswer}
The student answered: ${userAnswer}${instructionsContext}

Respond with ONLY valid JSON (no markdown, no code blocks): {"correct": true/false, "explanation": "brief 1-sentence explanation"}`;

      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          messages: [{ role: 'user', content: systemPrompt }],
          documentContent: '',
          model: 'gpt-4o-mini',
          provider: 'openai',
          roomId,
        },
      });

      if (error) throw error;

      let result: { correct: boolean; explanation: string };
      try {
        // Try to parse the response as JSON
        const content = data.content || '';
        // Strip markdown code blocks if present
        const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        result = JSON.parse(cleaned);
      } catch {
        // Fallback: simple string match
        const isCorrect = data.content?.toLowerCase().includes('"correct": true') ||
                          data.content?.toLowerCase().includes('"correct":true');
        result = {
          correct: isCorrect || false,
          explanation: data.content || 'Could not evaluate the answer.',
        };
      }

      applyFeedback(result.correct, result.explanation);
    } catch (err) {
      // On error, do a simple local evaluation
      const answer = userAnswer.trim().toLowerCase();
      const correct = currentQuestion.correctAnswer.toLowerCase();
      const isCorrect = correct.includes(answer) || answer.includes(correct.substring(0, 20));
      applyFeedback(isCorrect, isCorrect
        ? 'Looks correct!'
        : `The expected answer was: ${currentQuestion.correctAnswer.substring(0, 100)}...`);
    } finally {
      setIsEvaluating(false);
    }
  };

  const applyFeedback = (correct: boolean, explanation: string) => {
    setFeedback({ correct, explanation });

    const newSession = { ...session };
    newSession.total += 1;

    if (correct) {
      newSession.score += 1;
      newSession.streak += 1;
      if (newSession.streak > newSession.bestStreak) {
        newSession.bestStreak = newSession.streak;
      }
    } else {
      newSession.streak = 0;
      const newWrong = new Set(newSession.wrongCards);
      newWrong.add(currentQuestion.flashcardId);
      newSession.wrongCards = newWrong;
    }

    newSession.history = [
      ...session.history,
      {
        question: currentQuestion,
        userAnswer,
        correct,
        explanation,
      },
    ];

    setSession(newSession);

    // Auto-advance after delay
    autoAdvanceRef.current = setTimeout(() => {
      goToNext();
    }, correct ? 2000 : 3500);
  };

  const goToNext = () => {
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);

    if (currentIndex >= questions.length - 1) {
      // Session complete
      saveBestScore(roomId, session.score + (feedback?.correct ? 0 : 0), session.total);
      setShowSummary(true);
    } else {
      setCurrentIndex(currentIndex + 1);
      setUserAnswer('');
      setFeedback(null);
    }
  };

  const restartSession = () => {
    setQuestions(generateQuestions(flashcards));
    setCurrentIndex(0);
    setUserAnswer('');
    setFeedback(null);
    setShowSummary(false);
    setSession({
      score: 0,
      total: 0,
      streak: 0,
      bestStreak: 0,
      wrongCards: new Set(),
      history: [],
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !feedback) {
      e.preventDefault();
      evaluateAnswer();
    } else if (e.key === 'Enter' && feedback) {
      e.preventDefault();
      goToNext();
    }
  };

  // Not enough flashcards
  if (flashcards.length < 4) {
    return (
      <div className={`tutor-mode-panel ${isClosing ? 'closing' : ''}`}>
        <div className="tutor-close-row">
          <button className="tutor-close-button" onClick={handleClose} title="Close tutor mode">
            <X size={28} />
          </button>
        </div>
        <div className="tutor-not-enough">
          <Target size={48} />
          <h2>Need More Flashcards</h2>
          <p>
            Add at least 4 flashcards to your document to start a tutoring session.
            You currently have {flashcards.length} card{flashcards.length !== 1 ? 's' : ''}.
          </p>
          <p className="tutor-hint">
            Use <code>## Term</code> headers followed by definitions to create flashcards.
          </p>
        </div>
      </div>
    );
  }

  // Session summary
  if (showSummary) {
    const pct = session.total > 0 ? Math.round((session.score / session.total) * 100) : 0;
    const bestScore = getBestScore(roomId);
    const weakCards = flashcards.filter(c => session.wrongCards.has(c.id));

    return (
      <div className={`tutor-mode-panel ${isClosing ? 'closing' : ''}`}>
        <div className="tutor-close-row">
          <button className="tutor-close-button" onClick={handleClose} title="Close tutor mode">
            <X size={28} />
          </button>
        </div>
        <div className="tutor-summary">
          <div className="tutor-summary-header">
            <Trophy size={48} className="tutor-trophy" />
            <h2>Session Complete!</h2>
          </div>

          <div className="tutor-summary-stats">
            <div className="tutor-stat-card">
              <div className="tutor-stat-value">{session.score}/{session.total}</div>
              <div className="tutor-stat-label">Score</div>
            </div>
            <div className="tutor-stat-card">
              <div className="tutor-stat-value">{pct}%</div>
              <div className="tutor-stat-label">Accuracy</div>
            </div>
            <div className="tutor-stat-card">
              <div className="tutor-stat-value">{session.bestStreak}</div>
              <div className="tutor-stat-label">Best Streak</div>
            </div>
          </div>

          {bestScore && (
            <div className="tutor-best-score">
              Personal best: {bestScore.score}/{bestScore.total} ({Math.round((bestScore.score / bestScore.total) * 100)}%)
            </div>
          )}

          {weakCards.length > 0 && (
            <div className="tutor-weak-areas">
              <h3>Areas to Review</h3>
              <div className="tutor-weak-list">
                {weakCards.map(card => (
                  <div key={card.id} className="tutor-weak-card">
                    <span className="tutor-weak-term">{card.term}</span>
                    {card.section && <span className="tutor-weak-section">{card.section}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="tutor-summary-history">
            <h3>Question Review</h3>
            {session.history.map((entry, i) => (
              <div key={i} className={`tutor-history-item ${entry.correct ? 'correct' : 'wrong'}`}>
                <div className="tutor-history-icon">
                  {entry.correct ? <CheckCircle size={16} /> : <XCircle size={16} />}
                </div>
                <div className="tutor-history-content">
                  <div className="tutor-history-question">{entry.question.question}</div>
                  <div className="tutor-history-answer">Your answer: {entry.userAnswer}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="tutor-summary-actions">
            <button className="tutor-restart-button" onClick={restartSession}>
              <RotateCcw size={18} />
              Try Again
            </button>
            <button className="tutor-done-button" onClick={handleClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Quiz UI
  const typeLabel = currentQuestion?.type === 'define' ? 'Define'
    : currentQuestion?.type === 'identify' ? 'Identify'
    : currentQuestion?.type === 'truefalse' ? 'True / False'
    : 'Fill in the Blank';

  return (
    <div className={`tutor-mode-panel ${isClosing ? 'closing' : ''}`}>
      {/* Progress bar */}
      <div className="tutor-progress-bar">
        <div className="tutor-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Header */}
      <div className="tutor-header">
        <div className="tutor-score-area">
          <div className="tutor-score">
            <CheckCircle size={18} />
            <span>{session.score}/{session.total}</span>
          </div>
          {session.streak > 1 && (
            <div className="tutor-streak">
              <Flame size={18} />
              <span>{session.streak}</span>
            </div>
          )}
        </div>
        <div className="tutor-question-count">
          {currentIndex + 1} / {questions.length}
        </div>
        <button className="tutor-close-button" onClick={handleClose} title="Close tutor mode">
          <X size={28} />
        </button>
      </div>

      {/* Question area */}
      <div className="tutor-question-area">
        <div className={`tutor-question-card ${feedback ? (feedback.correct ? 'correct' : 'wrong') : ''}`}>
          <div className="tutor-question-type">{typeLabel}</div>
          {currentQuestion?.section && (
            <div className="tutor-question-section">{currentQuestion.section}</div>
          )}
          <div className="tutor-question-text">{currentQuestion?.question}</div>
          {currentQuestion?.detail && (
            <div className="tutor-question-detail">
              <ReactMarkdown>{currentQuestion.detail}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>

      {/* Answer input */}
      <div className="tutor-answer-area">
        {currentQuestion?.type === 'truefalse' ? (
          <div className="tutor-tf-buttons">
            <button
              className={`tutor-tf-button true ${feedback && userAnswer.toLowerCase() === 'true' ? (feedback.correct ? 'correct' : 'wrong') : ''}`}
              onClick={() => {
                if (feedback) return;
                setUserAnswer('True');
                // Auto-evaluate
                setTimeout(() => {
                  const normalized = 'true';
                  const correct = (normalized === 'true')
                    ? currentQuestion.correctAnswer === 'True'
                    : currentQuestion.correctAnswer === 'False';
                  const explanation = correct
                    ? `Correct! The answer is ${currentQuestion.correctAnswer}.`
                    : `The correct answer is ${currentQuestion.correctAnswer}.`;
                  applyFeedback(correct, explanation);
                }, 100);
              }}
              disabled={!!feedback}
            >
              True
            </button>
            <button
              className={`tutor-tf-button false ${feedback && userAnswer.toLowerCase() === 'false' ? (feedback.correct ? 'correct' : 'wrong') : ''}`}
              onClick={() => {
                if (feedback) return;
                setUserAnswer('False');
                setTimeout(() => {
                  const normalized = 'false';
                  const correct = (normalized === 'false')
                    ? currentQuestion.correctAnswer === 'False'
                    : currentQuestion.correctAnswer === 'True';
                  const explanation = correct
                    ? `Correct! The answer is ${currentQuestion.correctAnswer}.`
                    : `The correct answer is ${currentQuestion.correctAnswer}.`;
                  applyFeedback(correct, explanation);
                }, 100);
              }}
              disabled={!!feedback}
            >
              False
            </button>
          </div>
        ) : (
          <div className="tutor-input-row">
            <input
              ref={inputRef}
              className="tutor-answer-input"
              type="text"
              placeholder={
                currentQuestion?.type === 'identify'
                  ? 'Type the term...'
                  : currentQuestion?.type === 'fillin'
                    ? 'Type the missing word...'
                    : 'Type your answer...'
              }
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={!!feedback || isEvaluating}
            />
            {!feedback && (
              <button
                className="tutor-submit-button"
                onClick={evaluateAnswer}
                disabled={!userAnswer.trim() || isEvaluating}
              >
                {isEvaluating ? <Loader2 size={18} className="spinning" /> : <ArrowRight size={18} />}
              </button>
            )}
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className={`tutor-feedback ${feedback.correct ? 'correct' : 'wrong'}`}>
            <div className="tutor-feedback-row">
              <div className="tutor-feedback-icon">
                {feedback.correct ? <CheckCircle size={24} /> : <XCircle size={24} />}
              </div>
              <div className="tutor-feedback-content">
                <div className="tutor-feedback-title">
                  {feedback.correct ? getEncouragingMessage() : getMissMessage()}
                </div>
              </div>
              <button className="tutor-next-button" onClick={goToNext}>
                {currentIndex >= questions.length - 1 ? 'View Results' : 'Next'}
                <ArrowRight size={16} />
              </button>
            </div>
            {!feedback.correct && currentQuestion && (
              <div className="tutor-correct-answer">
                <div className="tutor-correct-answer-label">Correct answer</div>
                <div className="tutor-correct-answer-text">
                  <ReactMarkdown>{currentQuestion.correctAnswer}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Keyboard hints */}
      <div className="tutor-keyboard-hints">
        <span>Enter: Submit / Next</span>
        <span>Esc: Exit</span>
      </div>
    </div>
  );
}
