import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import type { JobHandle, HardwareResult } from '../../types/hardware';

interface JobTrackerProps {
  jobs: JobHandle[];
  results: Record<string, HardwareResult>;
}

const STATUS_CONFIG: Record<
  JobHandle['status'],
  { label: string; colorKey: 'info' | 'warning' | 'success' | 'error' }
> = {
  queued: { label: 'Queued', colorKey: 'info' },
  running: { label: 'Running', colorKey: 'warning' },
  complete: { label: 'Complete', colorKey: 'success' },
  failed: { label: 'Failed', colorKey: 'error' },
  // Transient status from the provider — recovers on the next poll.
  unknown: { label: 'Unknown', colorKey: 'warning' },
  // Kernel restarted and dropped the in-memory handle. Job persistence
  // (PRD item 7) re-attaches these on kernel boot; until then the UI
  // just shows them distinctly so users know to re-run.
  stale: { label: 'Stale', colorKey: 'warning' },
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function JobRow({
  job,
  result,
}: {
  job: JobHandle;
  result: HardwareResult | undefined;
}) {
  const colors = useThemeStore((s) => s.colors);
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[job.status];
  const statusColor = colors[cfg.colorKey];
  const canExpand = job.status === 'complete' && result;

  return (
    <div style={{ borderBottom: `1px solid ${colors.border}` }}>
      <button
        onClick={() => canExpand && setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 0',
          background: 'transparent',
          border: 'none',
          cursor: canExpand ? 'pointer' : 'default',
          textAlign: 'left',
        }}
      >
        {canExpand ? (
          expanded ? (
            <ChevronDown size={10} color={colors.textDim} />
          ) : (
            <ChevronRight size={10} color={colors.textDim} />
          )
        ) : (
          <div style={{ width: 10 }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: colors.text,
              fontFamily: "'Geist Sans', sans-serif",
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {job.backend}
          </div>
          <div
            style={{
              fontSize: 10,
              color: colors.textDim,
              fontFamily: "'Geist Sans', sans-serif",
              marginTop: 1,
            }}
          >
            {job.shots} shots &middot; {formatTime(job.submittedAt)}
          </div>
        </div>

        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 3,
            background: `${statusColor}20`,
            color: statusColor,
            fontFamily: "'Geist Sans', sans-serif",
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            flexShrink: 0,
          }}
        >
          {cfg.label}
        </span>
      </button>

      {expanded && result && (
        <div style={{ padding: '0 0 8px 16px' }}>
          <div
            style={{
              fontSize: 10,
              color: colors.textDim,
              fontFamily: "'Geist Sans', sans-serif",
              marginBottom: 4,
            }}
          >
            Execution: {result.executionTimeMs}ms
          </div>
          {Object.entries(result.measurements)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 8)
            .map(([bitstring, count]) => (
              <div
                key={bitstring}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 2,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: colors.textMuted,
                    fontFamily: "'JetBrains Mono', monospace",
                    minWidth: 40,
                  }}
                >
                  |{bitstring}⟩
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: colors.textDim,
                    fontFamily: "'Geist Sans', sans-serif",
                  }}
                >
                  {count}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export function JobTracker({ jobs, results }: JobTrackerProps) {
  const colors = useThemeStore((s) => s.colors);

  if (jobs.length === 0) {
    return (
      <div
        style={{
          padding: '16px 0',
          fontSize: 11,
          color: colors.textDim,
          fontFamily: "'Geist Sans', sans-serif",
          textAlign: 'center',
        }}
      >
        No jobs submitted yet
      </div>
    );
  }

  return (
    <div>
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} result={results[job.id]} />
      ))}
    </div>
  );
}
