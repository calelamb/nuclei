import ReactMarkdown from 'react-markdown';
import { useThemeStore } from '../../stores/themeStore';
import { MaxCutGraphViz } from './MaxCutGraphViz';
import type { QuantumChallenge, ChallengeExample } from '../../types/challenge';

interface ProblemDescriptionProps {
  challenge: QuantumChallenge;
}

function ExampleBox({ example, index }: { example: ChallengeExample; index: number }) {
  const colors = useThemeStore((s) => s.colors);

  return (
    <div style={{
      borderRadius: 8,
      border: `1px solid ${colors.border}`,
      background: colors.bgPanel,
      overflow: 'hidden',
      marginBottom: 12,
    }}>
      <div style={{
        padding: '6px 12px',
        background: colors.bgElevated,
        borderBottom: `1px solid ${colors.border}`,
        color: colors.textMuted,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "'Geist Sans', sans-serif",
      }}>
        Example {index + 1}
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ marginBottom: 8 }}>
          <span style={{
            color: colors.textDim,
            fontSize: 11,
            fontFamily: "'Geist Mono', monospace",
            fontWeight: 600,
          }}>
            Input:
          </span>
          <pre style={{
            margin: '4px 0 0',
            padding: '6px 8px',
            borderRadius: 4,
            background: colors.bg,
            color: colors.text,
            fontSize: 12,
            fontFamily: "'Geist Mono', monospace",
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
          }}>
            {example.input}
          </pre>
        </div>
        <div style={{ marginBottom: example.explanation ? 8 : 0 }}>
          <span style={{
            color: colors.textDim,
            fontSize: 11,
            fontFamily: "'Geist Mono', monospace",
            fontWeight: 600,
          }}>
            Output:
          </span>
          <pre style={{
            margin: '4px 0 0',
            padding: '6px 8px',
            borderRadius: 4,
            background: colors.bg,
            color: colors.text,
            fontSize: 12,
            fontFamily: "'Geist Mono', monospace",
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
          }}>
            {example.output}
          </pre>
        </div>
        {example.explanation && (
          <div>
            <span style={{
              color: colors.textDim,
              fontSize: 11,
              fontFamily: "'Geist Mono', monospace",
              fontWeight: 600,
            }}>
              Explanation:
            </span>
            <p style={{
              margin: '4px 0 0',
              color: colors.textMuted,
              fontSize: 12,
              fontFamily: "'Geist Sans', sans-serif",
              lineHeight: 1.5,
            }}>
              {example.explanation}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProblemDescription({ challenge }: ProblemDescriptionProps) {
  const colors = useThemeStore((s) => s.colors);

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      padding: '20px 24px 48px',
    }}>
      {/* Description (markdown) */}
      <div style={{
        color: colors.text,
        fontSize: 14,
        fontFamily: "'Geist Sans', sans-serif",
        lineHeight: 1.7,
      }}>
        <ReactMarkdown
          components={{
            h1: ({ children }) => (
              <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: '0 0 12px' }}>
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 style={{ fontSize: 17, fontWeight: 600, color: colors.text, margin: '20px 0 8px' }}>
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 style={{ fontSize: 15, fontWeight: 600, color: colors.text, margin: '16px 0 6px' }}>
                {children}
              </h3>
            ),
            p: ({ children }) => (
              <p style={{ margin: '0 0 12px', lineHeight: 1.7 }}>
                {children}
              </p>
            ),
            code: ({ children, className }) => {
              const isBlock = className?.includes('language-');
              if (isBlock) {
                return (
                  <pre style={{
                    padding: '10px 12px',
                    borderRadius: 6,
                    background: colors.bgPanel,
                    border: `1px solid ${colors.border}`,
                    overflowX: 'auto',
                    fontSize: 12,
                    fontFamily: "'Geist Mono', monospace",
                    margin: '0 0 12px',
                  }}>
                    <code>{children}</code>
                  </pre>
                );
              }
              return (
                <code style={{
                  padding: '2px 5px',
                  borderRadius: 3,
                  background: colors.bgElevated,
                  fontSize: 12,
                  fontFamily: "'Geist Mono', monospace",
                  color: colors.accent,
                }}>
                  {children}
                </code>
              );
            },
            strong: ({ children }) => (
              <strong style={{ color: colors.text, fontWeight: 600 }}>
                {children}
              </strong>
            ),
          }}
        >
          {challenge.description}
        </ReactMarkdown>
      </div>

      {/* Visualization (if present) */}
      {challenge.visualization && (
        <div style={{ margin: '16px 0' }}>
          <MaxCutGraphViz visualization={challenge.visualization} />
        </div>
      )}

      {/* Constraints */}
      {challenge.constraints.length > 0 && (
        <div style={{ margin: '20px 0' }}>
          <h3 style={{
            color: colors.text,
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
            margin: '0 0 8px',
          }}>
            Constraints
          </h3>
          <ul style={{
            margin: 0,
            padding: '0 0 0 20px',
            color: colors.textMuted,
            fontSize: 13,
            fontFamily: "'Geist Sans', sans-serif",
            lineHeight: 1.8,
          }}>
            {challenge.constraints.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Examples */}
      {challenge.examples.length > 0 && (
        <div style={{ margin: '20px 0' }}>
          <h3 style={{
            color: colors.text,
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
            margin: '0 0 10px',
          }}>
            Examples
          </h3>
          {challenge.examples.map((ex, i) => (
            <ExampleBox key={i} example={ex} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
