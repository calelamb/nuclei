import { useHardwareStore } from '../../stores/hardwareStore';
import { HistogramChip } from '../histogram/HistogramChip';

/* ── Hardware-aware histogram chip ──
 * Wraps HistogramChip to pipe in the most recent completed hardware-job
 * probabilities alongside the classical-simulator run. When a hardware job
 * has completed, the chip shows dual bars per outcome (sim vs hw).
 */
export function HardwareAwareHistogramChip({
  simProbabilities,
  onDismiss,
}: {
  simProbabilities: Record<string, number> | null;
  onDismiss: () => void;
}) {
  const jobs = useHardwareStore((s) => s.jobs);
  const results = useHardwareStore((s) => s.results);
  const completed = jobs.find((j) => j.status === 'complete');
  const hwProbabilities = completed ? results[completed.id]?.probabilities ?? null : null;
  const hwLabel = completed ? `${completed.backend} (${completed.shots} shots)` : undefined;
  return (
    <HistogramChip
      probabilities={simProbabilities}
      hwProbabilities={hwProbabilities}
      hwLabel={hwLabel}
      onDismiss={onDismiss}
    />
  );
}
