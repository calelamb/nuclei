import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { arrowNavTarget } from '../../lib/arrowNav';
import { useLearnStore } from '../../stores/learnStore';
import type { QuizQuestion } from '../../data/lessons/types';
import { Button } from '../ui';
import './lessonBlocks.css';

interface QuizBlockProps {
  questions: QuizQuestion[];
}

type OptionState = 'idle' | 'wrong' | 'right';

function optionState(index: number, chosen: number | null, correctIndex: number, solved: boolean): OptionState {
  if (solved && index === correctIndex) return 'right';
  if (!solved && chosen === index) return 'wrong';
  return 'idle';
}

function moveOptionFocus(event: KeyboardEvent<HTMLDivElement>, count: number) {
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const current = radios.findIndex((r) => r === document.activeElement);
  const target = arrowNavTarget(event.key, Math.max(0, current), count);
  if (target === null) return;
  event.preventDefault();
  radios[target]?.focus();
}

export function QuizBlock({ questions }: QuizBlockProps) {
  const lessonId = useLearnStore((s) => s.currentLessonId);
  const setQuizScore = useLearnStore((s) => s.setQuizScore);

  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const [solvedIds, setSolvedIds] = useState<Record<string, boolean>>({});
  // The option last picked stays the roving tab stop after Try again, so keyboard focus has somewhere to land.
  const [lastChosen, setLastChosen] = useState<Record<string, number>>({});
  const optionRefs = useRef<Record<string, Array<HTMLButtonElement | null>>>({});
  const pendingFocus = useRef<{ qId: string; index: number } | null>(null);

  // Try again unmounts its own button; hand focus back to the option the learner just picked.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    optionRefs.current[target.qId]?.[target.index]?.focus();
  });

  const handleAnswer = (qId: string, index: number, correctIndex: number) => {
    if (solvedIds[qId]) return;
    setAnswers((a) => ({ ...a, [qId]: index }));
    setLastChosen((c) => ({ ...c, [qId]: index }));
    if (index === correctIndex) {
      setSolvedIds((r) => ({ ...r, [qId]: true }));
      if (lessonId) setQuizScore(lessonId, qId, 1);
    }
  };

  const retry = (qId: string) => {
    pendingFocus.current = { qId, index: lastChosen[qId] ?? 0 };
    setAnswers((a) => ({ ...a, [qId]: null }));
  };

  return (
    <div className="quiz">
      {questions.map((q) => {
        const chosen = answers[q.id] ?? null;
        const solved = Boolean(solvedIds[q.id]);
        const questionId = `quiz-${q.id}`;

        return (
          <div key={q.id} className="quiz__card" data-solved={solved}>
            <p className="quiz__question" id={questionId}>{q.question}</p>

            <div className="quiz__options" role="radiogroup" aria-labelledby={questionId} onKeyDown={(e) => moveOptionFocus(e, q.options.length)}>
              {q.options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={chosen === i}
                  className="quiz__option"
                  data-state={optionState(i, chosen, q.correctIndex, solved)}
                  ref={(el) => {
                    const row = optionRefs.current[q.id] ?? [];
                    row[i] = el;
                    optionRefs.current[q.id] = row;
                  }}
                  tabIndex={i === (chosen ?? lastChosen[q.id] ?? 0) ? 0 : -1}
                  // Not `disabled`: a solved option must keep keyboard focus.
                  aria-disabled={solved || undefined}
                  onClick={() => handleAnswer(q.id, i, q.correctIndex)}
                >
                  <span className="quiz__letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                  {opt}
                </button>
              ))}
            </div>

            {chosen !== null && !solved && (
              <div className="quiz__feedback quiz__feedback--wrong" role="status">
                <span>{`${String.fromCharCode(65 + chosen)} isn't the answer.`}</span>
                <Button size="sm" variant="secondary" onClick={() => retry(q.id)}>Try again</Button>
              </div>
            )}

            {solved && (
              <div className="quiz__feedback quiz__feedback--right" role="status">
                <strong>Correct!</strong> {q.explanation}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
