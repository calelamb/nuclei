import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { useExperimentRunStore } from '../../stores/experimentRunStore';
import type { RunSummary } from '../../services/experimentRunner';
import { TYPOGRAPHY, ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore } from '../../services/experimentStore';
import { useExperimentRun } from '../../hooks/useExperimentRun';
import { Button, IconButton } from '../ui';

const SUMMARY_VISIBLE_MS = 8000;

/** "96 runs, 1 failed" / "Cancelled after 12 of 96 runs". */
function describeRunSummary(summary: RunSummary): string {
  const noun = summary.total === 1 ? 'run' : 'runs';
  if (summary.cancelled) return `Cancelled after ${summary.completed} of ${summary.total} ${noun}`;
  const failed = summary.failed > 0 ? `, ${summary.failed} failed` : '';
  return `${summary.total} ${noun}${failed}`;
}

/** Turns raw transport errors into a sentence a person can act on. */
function humanizeRunError(raw: string): string {
  if (/failed to connect to kernel/i.test(raw)) {
    return "Couldn't reach the Python kernel. Check the kernel status in the toolbar, then retry.";
  }
  return raw;
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
  // The runs table shows the full banner when an experiment is open; the
  // sidebar copy is then visual only so screen readers hear the message once.
  const tableVisible = useExperimentUiStore((s) => s.selectedExperimentFileName !== null);
  const clearFeedback = useExperimentRunStore((s) => s.clearFeedback);
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const selectedFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);
  const experiments = useExperimentStore((s) => s.experiments);
  const { run } = useExperimentRun();

  useEffect(() => {
    if (lastError || !lastSummary || compact) return;
    const timer = setTimeout(clearFeedback, SUMMARY_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [lastError, lastSummary, compact, clearFeedback]);

  if (!lastError && !lastSummary) return null;
  const isError = lastError !== null;
  const hasFailures = !isError && lastSummary !== null && lastSummary.failed > 0;
  const tone = isError || hasFailures ? colors.error : colors.success;
  // Retry re-runs the open experiment; hardware sweeps keep their confirm step on the Run button.
  const retryTarget = experiments.find((e) => e.fileName === selectedFileName);
  const canRetry = isError && !compact && projectRoot !== null && retryTarget !== undefined
    && retryTarget.spec.type !== 'qec_campaign' && retryTarget.spec.backend.provider === 'simulator';
  const handleRetry = () => {
    if (!retryTarget || !projectRoot) return;
    clearFeedback();
    void run(retryTarget, projectRoot);
  };
  const text = isError ? humanizeRunError(lastError) : describeRunSummary(lastSummary as RunSummary);

  return (
    <div
      role={compact && tableVisible ? undefined : 'status'}
      aria-hidden={compact && tableVisible ? true : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: compact ? '5px 8px' : '8px 14px',
        margin: compact ? '4px 0 0' : 0,
        background: `${tone}14`, borderBottom: compact ? undefined : `1px solid ${colors.border}`,
        borderLeft: `2px solid ${tone}`, borderRadius: compact ? 'var(--radius-xs)' : 0,
        color: colors.text, fontSize: compact ? 11 : 12, lineHeight: 1.4,
        fontFamily: TYPOGRAPHY.fontSans, flexShrink: 0,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        {isError ? <><strong style={{ color: tone }}>Run failed.</strong> {text}</> : text}
      </span>
      {canRetry && <Button size="sm" variant="secondary" onClick={handleRetry}>Retry</Button>}
      <IconButton size="sm" aria-label="Dismiss run message" onClick={clearFeedback}>
        <X size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
      </IconButton>
    </div>
  );
}
