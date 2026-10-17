import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { Check, X, Clock, ChevronRight, ChevronDown, Star } from 'lucide-react';
import type { Submission, SubmissionStatus } from '../../types/challenge';

import { TYPOGRAPHY } from '../../styles/tokens';
interface SubmissionHistoryProps {
  submissions: Submission[];
}

function SubmissionRow({ submission, index }: { submission: Submission; index: number }) {
  const colors = useThemeStore((s) => s.colors);
  const [expanded, setExpanded] = useState(false);

  const STATUS_META: Record<SubmissionStatus, { label: string; color: string }> = {
    pending: { label: 'Pending', color: colors.textDim },
    running: { label: 'Running', color: colors.accent },
    accepted: { label: 'Accepted', color: colors.success },
    wrong_answer: { label: 'Wrong Answer', color: colors.error },
    runtime_error: { label: 'Runtime Error', color: colors.error },
    compile_error: { label: 'Compile Error', color: colors.warning },
    time_limit_exceeded: { label: 'Time Limit Exceeded', color: colors.warning },
  };
  const statusMeta = STATUS_META[submission.status];
  const isAccepted = submission.status === 'accepted';

  const date = new Date(submission.timestamp);
  const timeStr = date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div style={{
      borderBottom: `1px solid ${colors.border}`,
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgElevated; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {expanded
          ? <ChevronDown size={12} color={colors.textDim} />
          : <ChevronRight size={12} color={colors.textDim} />
        }

        <span style={{
          color: colors.textDim,
          fontSize: 11,
          fontFamily: TYPOGRAPHY.fontMono,
          width: 20,
        }}>
          #{index + 1}
        </span>

        {/* Status badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 8px',
          borderRadius: 4,
          background: `${statusMeta.color}18`,
          color: statusMeta.color,
          fontSize: 11,
          fontWeight: 600,
          fontFamily: TYPOGRAPHY.fontSans,
        }}>
          {isAccepted ? <Check size={10} /> : <X size={10} />}
          {statusMeta.label}
        </div>

        {/* Score */}
        <span style={{
          color: colors.textMuted,
          fontSize: 11,
          fontWeight: 600,
          fontFamily: TYPOGRAPHY.fontMono,
        }}>
          {submission.totalScore}%
        </span>

        {/* Framework */}
        <span style={{
          padding: '1px 6px',
          borderRadius: 3,
          background: `${colors.accent}12`,
          color: colors.accent,
          fontSize: 11,
          fontFamily: TYPOGRAPHY.fontSans,
        }}>
          {submission.framework}
        </span>

        <div style={{ flex: 1 }} />

        {/* Time */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          color: colors.textDim,
          fontSize: 11,
          fontFamily: TYPOGRAPHY.fontSans,
        }}>
          <Clock size={10} />
          {timeStr}
        </div>
      </button>

      {/* Expanded test case breakdown */}
      {expanded && (
        <div style={{
          padding: '4px 12px 10px 44px',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}>
          {submission.testCaseResults.map((tcr, i) => (
            <div
              key={tcr.testCaseId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '3px 0',
              }}
            >
              {tcr.passed
                ? <Check size={10} color={colors.success} />
                : <X size={10} color={colors.error} />
              }
              <span style={{
                color: colors.textMuted,
                fontSize: 11,
                fontFamily: TYPOGRAPHY.fontSans,
                flex: 1,
              }}>
                Test {i + 1}
              </span>
              <span style={{
                color: tcr.passed ? colors.success : colors.error,
                fontSize: 11,
                fontWeight: 600,
                fontFamily: TYPOGRAPHY.fontMono,
              }}>
                {(tcr.score * 100).toFixed(0)}%
              </span>
              {tcr.executionTimeMs > 0 && (
                <span style={{
                  color: colors.textDim,
                  fontSize: 11,
                  fontFamily: TYPOGRAPHY.fontMono,
                  minWidth: 40,
                  textAlign: 'right',
                }}>
                  {Math.round(tcr.executionTimeMs)}ms
                </span>
              )}
            </div>
          ))}

          {submission.metrics && (
            <div style={{
              marginTop: 4,
              padding: '6px 0 2px',
              borderTop: `1px solid ${colors.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              color: colors.textDim,
              fontSize: 11,
              fontFamily: TYPOGRAPHY.fontMono,
            }}>
              {submission.efficiency?.isOptimal && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  color: colors.success,
                  fontWeight: 700,
                  fontFamily: TYPOGRAPHY.fontSans,
                }}>
                  <Star size={10} fill={colors.success} strokeWidth={0} />
                  Optimal
                </span>
              )}
              <span>2q gates: <span style={{ color: colors.textMuted, fontWeight: 600 }}>{submission.metrics.twoQubitGates}</span></span>
              <span>depth: <span style={{ color: colors.textMuted, fontWeight: 600 }}>{submission.metrics.depth}</span></span>
              <span>gates: <span style={{ color: colors.textMuted, fontWeight: 600 }}>{submission.metrics.gateCount}</span></span>
              <span>qubits: <span style={{ color: colors.textMuted, fontWeight: 600 }}>{submission.metrics.qubits}</span></span>
            </div>
          )}

          <div style={{
            marginTop: 4,
            padding: '4px 0',
            borderTop: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{
              color: colors.textDim,
              fontSize: 11,
              fontFamily: TYPOGRAPHY.fontSans,
            }}>
              Total execution: {Math.round(submission.executionTimeMs)}ms
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function SubmissionHistory({ submissions }: SubmissionHistoryProps) {
  const colors = useThemeStore((s) => s.colors);

  if (submissions.length === 0) {
    return (
      <span style={{
        color: colors.textDim,
        fontSize: 12,
        fontStyle: 'italic',
        fontFamily: TYPOGRAPHY.fontSans,
      }}>
        No submissions yet.
      </span>
    );
  }

  // Most recent first
  const sorted = [...submissions].reverse();

  return (
    <div>
      <div style={{
        color: colors.textMuted,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: TYPOGRAPHY.fontSans,
        marginBottom: 6,
      }}>
        Submission History ({submissions.length})
      </div>
      {sorted.map((sub, i) => (
        <SubmissionRow
          key={sub.id}
          submission={sub}
          index={submissions.length - i}
        />
      ))}
    </div>
  );
}
