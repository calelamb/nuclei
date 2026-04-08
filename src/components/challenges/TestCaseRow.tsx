import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { Check, X, Loader, Minus, ChevronRight, ChevronDown } from 'lucide-react';
import type { TestCase, TestCaseResult } from '../../types/challenge';

interface TestCaseRowProps {
  testCase: TestCase;
  result?: TestCaseResult;
  isRunning: boolean;
  index: number;
}

function StatusIcon({ result, isRunning }: { result?: TestCaseResult; isRunning: boolean }) {
  const colors = useThemeStore((s) => s.colors);

  if (isRunning) {
    return (
      <div style={{
        width: 18,
        height: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Loader
          size={14}
          color={colors.accent}
          style={{ animation: 'spin 1s linear infinite' }}
        />
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!result) {
    return <Minus size={14} color={colors.textDim} style={{ opacity: 0.4 }} />;
  }

  if (result.passed) {
    return (
      <div style={{
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: `${colors.success}20`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Check size={11} color={colors.success} strokeWidth={3} />
      </div>
    );
  }

  return (
    <div style={{
      width: 18,
      height: 18,
      borderRadius: '50%',
      background: `${colors.error}20`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <X size={11} color={colors.error} strokeWidth={3} />
    </div>
  );
}

export function TestCaseRow({ testCase, result, isRunning, index }: TestCaseRowProps) {
  const colors = useThemeStore((s) => s.colors);
  const [expanded, setExpanded] = useState(false);

  const isHidden = testCase.hidden;
  const hasDetails = result && !isHidden;
  const canExpand = hasDetails || (isHidden && !result);

  const label = isHidden
    ? `Hidden Test ${index + 1}`
    : testCase.label || `Test Case ${index + 1}`;

  return (
    <div style={{
      borderBottom: `1px solid ${colors.border}`,
    }}>
      {/* Row header */}
      <button
        onClick={() => canExpand && setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 16px',
          background: 'transparent',
          border: 'none',
          cursor: canExpand ? 'pointer' : 'default',
          textAlign: 'left',
        }}
        onMouseEnter={(e) => {
          if (canExpand) e.currentTarget.style.background = colors.bgElevated;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Expand chevron */}
        {canExpand ? (
          expanded
            ? <ChevronDown size={12} color={colors.textDim} />
            : <ChevronRight size={12} color={colors.textDim} />
        ) : (
          <div style={{ width: 12 }} />
        )}

        {/* Status icon */}
        <StatusIcon result={result} isRunning={isRunning} />

        {/* Label */}
        <span style={{
          flex: 1,
          color: isHidden && !result ? colors.textDim : colors.text,
          fontSize: 12,
          fontFamily: "'Geist Sans', sans-serif",
          fontStyle: isHidden && !result ? 'italic' : 'normal',
        }}>
          {label}
        </span>

        {/* Score */}
        {result && (
          <span style={{
            color: result.passed ? colors.success : colors.error,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "'Geist Mono', monospace",
          }}>
            {result.score}/{testCase.weight}
          </span>
        )}

        {/* Execution time */}
        {result && result.executionTimeMs > 0 && (
          <span style={{
            color: colors.textDim,
            fontSize: 10,
            fontFamily: "'Geist Mono', monospace",
            minWidth: 48,
            textAlign: 'right',
          }}>
            {result.executionTimeMs < 1000
              ? `${Math.round(result.executionTimeMs)}ms`
              : `${(result.executionTimeMs / 1000).toFixed(1)}s`
            }
          </span>
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div style={{
          padding: '0 16px 10px 56px',
        }}>
          {isHidden && !result ? (
            <span style={{
              color: colors.textDim,
              fontSize: 12,
              fontStyle: 'italic',
              fontFamily: "'Geist Sans', sans-serif",
            }}>
              Hidden -- revealed after submission
            </span>
          ) : result ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
              {/* Message */}
              <div style={{
                padding: '6px 10px',
                borderRadius: 4,
                background: result.passed ? `${colors.success}08` : `${colors.error}08`,
                border: `1px solid ${result.passed ? `${colors.success}20` : `${colors.error}20`}`,
                color: colors.textMuted,
                fontSize: 12,
                fontFamily: "'Geist Sans', sans-serif",
                lineHeight: 1.5,
              }}>
                {result.message}
              </div>

              {/* Expected vs actual */}
              {result.actualOutput && (
                <div style={{
                  display: 'flex',
                  gap: 12,
                  fontSize: 11,
                  fontFamily: "'Geist Mono', monospace",
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      color: colors.textDim,
                      marginBottom: 2,
                      fontFamily: "'Geist Sans', sans-serif",
                      fontWeight: 600,
                    }}>
                      Actual Output
                    </div>
                    <pre style={{
                      margin: 0,
                      padding: '6px 8px',
                      borderRadius: 4,
                      background: colors.bgPanel,
                      color: colors.text,
                      overflowX: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {JSON.stringify(result.actualOutput, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
