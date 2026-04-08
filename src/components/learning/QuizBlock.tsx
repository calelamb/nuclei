import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useLearnStore } from '../../stores/learnStore';
import type { QuizQuestion } from '../../data/lessons/types';

interface QuizBlockProps {
  questions: QuizQuestion[];
}

export function QuizBlock({ questions }: QuizBlockProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const lessonId = useLearnStore((s) => s.currentLessonId);
  const setQuizScore = useLearnStore((s) => s.setQuizScore);

  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const handleAnswer = (qId: string, index: number, correctIndex: number) => {
    if (revealed[qId]) return;
    setAnswers((a) => ({ ...a, [qId]: index }));
    if (index === correctIndex) {
      setRevealed((r) => ({ ...r, [qId]: true }));
      if (lessonId) setQuizScore(lessonId, qId, 1);
    }
  };

  const retry = (qId: string) => {
    setAnswers((a) => ({ ...a, [qId]: null }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, margin: '16px 0' }}>
      {questions.map((q) => {
        const chosen = answers[q.id] ?? null;
        const isCorrect = chosen === q.correctIndex;
        const isRevealed = revealed[q.id];

        return (
          <div key={q.id} style={{
            background: colors.bgElevated,
            border: `1px solid ${isRevealed ? colors.success : colors.border}`,
            borderRadius: 12,
            padding: 20,
            boxShadow: shadow.sm,
            transition: 'border-color 200ms ease',
          }}>
            <div style={{
              color: colors.text,
              fontSize: 15,
              fontWeight: 500,
              marginBottom: 12,
              fontFamily: "'Geist Sans', sans-serif",
            }}>
              {q.question}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {q.options.map((opt, i) => {
                const isSelected = chosen === i;
                const isRight = i === q.correctIndex;
                let bg = 'transparent';
                let borderColor = colors.border;
                let textColor = colors.text;

                if (isSelected && !isRevealed) {
                  bg = `${colors.error}15`;
                  borderColor = colors.error;
                  textColor = colors.error;
                }
                if (isRevealed && isRight) {
                  bg = `${colors.success}15`;
                  borderColor = colors.success;
                  textColor = colors.success;
                }

                return (
                  <button
                    key={i}
                    onClick={() => handleAnswer(q.id, i, q.correctIndex)}
                    disabled={isRevealed}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      background: bg,
                      border: `1px solid ${borderColor}`,
                      borderRadius: 8,
                      color: textColor,
                      fontSize: 14,
                      fontFamily: "'Geist Sans', sans-serif",
                      cursor: isRevealed ? 'default' : 'pointer',
                      textAlign: 'left',
                      transition: 'all 150ms ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isRevealed) {
                        e.currentTarget.style.borderColor = colors.accent;
                        e.currentTarget.style.background = `${colors.accent}08`;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isRevealed && !isSelected) {
                        e.currentTarget.style.borderColor = colors.border;
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    <span style={{
                      width: 24, height: 24,
                      borderRadius: '50%',
                      border: `2px solid ${isRevealed && isRight ? colors.success : isSelected ? borderColor : colors.textDim}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 600, flexShrink: 0,
                      color: isRevealed && isRight ? colors.success : isSelected ? borderColor : colors.textDim,
                    }}>
                      {String.fromCharCode(65 + i)}
                    </span>
                    {opt}
                  </button>
                );
              })}
            </div>

            {/* Wrong answer feedback */}
            {chosen !== null && !isCorrect && !isRevealed && (
              <div style={{
                marginTop: 12,
                padding: '8px 12px',
                background: `${colors.error}10`,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{ color: colors.error, fontSize: 13, fontFamily: "'Geist Sans', sans-serif" }}>
                  Not quite — try again!
                </span>
                <button
                  onClick={() => retry(q.id)}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${colors.error}`,
                    borderRadius: 4,
                    color: colors.error,
                    fontSize: 12,
                    padding: '3px 10px',
                    cursor: 'pointer',
                    fontFamily: "'Geist Sans', sans-serif",
                  }}
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Correct answer explanation */}
            {isRevealed && (
              <div style={{
                marginTop: 12,
                padding: '10px 14px',
                background: `${colors.success}10`,
                borderRadius: 6,
                color: colors.success,
                fontSize: 13,
                fontFamily: "'Geist Sans', sans-serif",
                lineHeight: 1.5,
              }}>
                <span style={{ fontWeight: 600 }}>Correct!</span> {q.explanation}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
