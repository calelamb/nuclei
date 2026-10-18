import { Sparkles } from 'lucide-react';
import { LabButton, LabCallout, LabCard, LabProgress } from '../../lab';
import type { Digest } from '../../../services/conjecture/digest';
import type { ProposeBlocker, ProposeError } from '../../../services/conjecture/state';
import type { DroppedConjecture } from '../../../services/conjecture/proposer';

export function ConjectureHeader({ digest, blocker, proposing, error, dropped, onPropose }: {
  digest: Digest;
  blocker: ProposeBlocker | null;
  proposing: boolean;
  error: ProposeError | null;
  dropped: DroppedConjecture[];
  onPropose: () => void;
}) {
  return (
    <LabCard
      title="Conjectures"
      subtitle="Falsifiable claims about which circuit structures stay trainable, each tested on held-out circuits."
      actions={
        <LabButton variant="primary" icon={Sparkles} disabled={!!blocker || proposing} aria-describedby="cj-propose-reason" onClick={onPropose}>
          {proposing ? 'Proposing' : 'Propose conjectures'}
        </LabButton>
      }
    >
      <div className="cj-stack">
        <p id="cj-propose-reason" className="cj-caption" role="status">
          {blocker ? blocker.reason : 'Claude reads a capped digest of this run and proposes up to 5 conjectures. You review them before anything is tested.'}
        </p>
        {proposing && (
          <div className="lab-stack" style={{ gap: 'var(--space-2)' }}>
            <LabProgress value={null} label="Claude is reading the archive digest" />
            <span className="lab-muted" style={{ fontSize: 12 }}>Reading {digest.payload.elites.length} elites and proposing conjectures. This usually takes under a minute.</span>
          </div>
        )}
        {error && !blocker && <LabCallout tone="danger" title="Could not propose conjectures">{error.message}</LabCallout>}
        {dropped.length > 0 && (
          <LabCallout tone="warning" title={`${dropped.length} proposed conjecture${dropped.length === 1 ? '' : 's'} dropped`}>
            They did not match the kernel schema: {dropped.map((d) => `#${d.index + 1} ${d.issues[0]?.path ?? ''} ${d.issues[0]?.message ?? ''}`.trim()).join('; ')}.
          </LabCallout>
        )}
        <details>
          <summary className="cj-caption" style={{ cursor: 'pointer' }}>What the model sees (digest disclosure)</summary>
          <ul className="cj-caption" style={{ margin: 'var(--space-2) 0 0', paddingLeft: 18 }} aria-label="Digest disclosure">
            {digest.disclosures.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </details>
      </div>
    </LabCard>
  );
}
