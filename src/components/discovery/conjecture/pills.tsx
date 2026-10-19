import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import { LabPill, type LabTone } from '../../lab';
import { OUTCOME_LABEL } from '../../../services/conjecture/describe';
import type { ConjectureVerdict, EvidenceOutcome } from '../../../types/conjecture';

const VERDICT: Record<ConjectureVerdict | 'failed', { tone: LabTone; label: string; icon: typeof XCircle }> = {
  supported: { tone: 'success', label: 'Supported', icon: CheckCircle2 },
  refuted: { tone: 'danger', label: 'Refuted', icon: XCircle },
  inconclusive: { tone: 'warning', label: 'Inconclusive', icon: CircleHelp },
  failed: { tone: 'neutral', label: 'Did not finish', icon: CircleHelp },
};

export function VerdictPill({ verdict }: { verdict: ConjectureVerdict | 'failed' }) {
  const v = VERDICT[verdict];
  return (
    <LabPill tone={v.tone} icon={v.icon}>
      {v.label}
    </LabPill>
  );
}

const OUTCOME_TONE: Record<EvidenceOutcome, LabTone> = { meets: 'success', violates: 'danger', indeterminate: 'warning' };

export function OutcomePill({ outcome }: { outcome: EvidenceOutcome }) {
  return (
    <LabPill tone={OUTCOME_TONE[outcome]} dot outline={outcome === 'indeterminate'}>
      {OUTCOME_LABEL[outcome]}
    </LabPill>
  );
}
