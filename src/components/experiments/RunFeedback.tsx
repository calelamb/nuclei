import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useExperimentRunStore } from '../../stores/experimentRunStore';
import type { RunSummary } from '../../services/experimentRunner';

const SUMMARY_VISIBLE_MS = 8000;

/** "96 runs, 1 failed" / "Cancelled after 12 of 96 runs". */
function describeRunSummary(summary: RunSummary): string {
  const noun = summary.total === 1 ? 'run' : 'runs';
  if (summary.cancelled) return `Cancelled after ${summary.completed} of ${summary.total} ${noun}`;
  const failed = summary.failed > 0 ? `, ${summary.failed} failed` : '';
  return `${summary.total} ${noun}${failed}`;
}

/**
 * Post-run feedback: surfaces `lastError` (sweep could not start or crashed)
 * and `lastSummary` (outcome) which previously had no UI consumer, so failed
 * sweeps looked like nothing happened.
 */
export function RunFeedback({ compact = false }: { compact?: boolean }) {
  const colors = useThemeStore((s) => s.colors);
  const lastError = useExperimentRunStore((s) => s.lastError);
  const lastSummary = useExperimentRunStore((s) => s.lastSummary);
  const clearFeedback = useExperimentRunStore((s) => s.clearFeedback);

  useEffect(() => {
    if (lastError || !lastSummary || compact) return;
    const timer = setTimeout(clearFeedback, SUMMARY_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [lastError, lastSummary, compact, clearFeedback]);

  if (!lastError && !lastSummary) return null;
  const isError = lastError !== null;
  const hasFailures = !isError && lastSummary !== null && lastSummary.failed > 0;
  const tone = isError || hasFailures ? colors.error : colors.success;
  const text = isError ? lastError : describeRunSummary(lastSummary as RunSummary);

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: compact ? '5px 8px' : '8px 14px',
        margin: compact ? '4px 0 0' : 0,
        background: `${tone}14`, borderBottom: compact ? undefined : `1px solid ${colors.border}`,
        borderLeft: `2px solid ${tone}`, borderRadius: compact ? 3 : 0,
        color: colors.text, fontSize: compact ? 10.5 : 12, lineHeight: 1.4,
        fontFamily: "'Geist Sans', sans-serif", flexShrink: 0,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        {isError ? <><strong style={{ color: tone }}>Run failed.</strong> {text}</> : text}
      </span>
      <button
        onClick={clearFeedback}
        aria-label="Dismiss run message"
        style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', display: 'flex', padding: 0 }}
      >
        <X size={compact ? 11 : 13} />
      </button>
    </div>
  );
}
