import { LabPill } from '../lab';
import type { ResolvedMethod, ScalingVerdict } from '../../types/trainability';

export function MethodPill({ method }: { method: ResolvedMethod | undefined }) {
  return method === 'ppe' ? (
    <LabPill tone="dirac" outline title="Exact Pauli propagation with a rigorous truncation interval">
      Pauli propagation
    </LabPill>
  ) : (
    <LabPill tone="neutral" outline title="Monte-Carlo sampling with bootstrap confidence intervals">
      Sampling
    </LabPill>
  );
}

const VERDICT_PILL: Record<ScalingVerdict, { tone: 'danger' | 'success' | 'warning'; label: string }> = {
  barren_plateau: { tone: 'danger', label: 'Barren plateau' },
  polynomial: { tone: 'success', label: 'Polynomial' },
  inconclusive: { tone: 'warning', label: 'Inconclusive' },
};

export function VerdictPill({ verdict }: { verdict: ScalingVerdict }) {
  const { tone, label } = VERDICT_PILL[verdict];
  return (
    <LabPill tone={tone} dot>
      {label}
    </LabPill>
  );
}
