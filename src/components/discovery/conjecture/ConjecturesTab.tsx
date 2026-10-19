import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { LabButton, LabCallout, LabEmptyState, LabSkeleton } from '../../lab';
import { MIN_SCORED_ELITES, buildDigest } from '../../../services/conjecture/digest';
import { emptyRunConjectures, isActiveJob, proposeBlocker } from '../../../services/conjecture/state';
import { isConjectureTestActive, useConjectureStore } from '../../../stores/conjectureStore';
import { useDiracStore } from '../../../stores/diracStore';
import { useDiscoveryStore, type RunView } from '../../../stores/discoveryStore';
import { useProjectStore } from '../../../stores/projectStore';
import './conjecture.css';
import { ConjectureHeader } from './ConjectureHeader';
import { LedgerList } from './LedgerList';
import { ProposalCard } from './ProposalCard';
import { useConjectureBoot } from './useConjectureBoot';

const EMPTY = emptyRunConjectures();

/** The run view's Conjectures tab: propose, review, test and keep a ledger. */
export function ConjecturesTab({ view }: { view: RunView }) {
  const runId = view.run.run_id;
  const { available } = useConjectureBoot(runId);
  const state = useConjectureStore((s) => s.byRun[runId]) ?? EMPTY;
  const schema = useConjectureStore((s) => s.schema);
  const anyActive = useConjectureStore(isConjectureTestActive);
  const live = useDiscoveryStore((s) => s.liveRunIds.includes(runId));
  const hasKey = useDiracStore((s) => Boolean(s.apiKey?.trim()));
  const [ledgerOpenError, setLedgerOpenError] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  const digest = useMemo(() => buildDigest({ run: view.run, candidates: view.candidates }), [view.run, view.candidates]);
  const blocker = proposeBlocker({ hasKey, scoredElites: digest.scoredElites, live, minElites: MIN_SCORED_ELITES });
  const untestedAccepted = state.proposals.filter((p) => p.decision === 'accepted' && !state.jobs[p.conjecture.id]).length;

  const openLedger = async () => {
    setLedgerOpenError(null);
    const res = await useConjectureStore.getState().readLedgerMarkdown(runId);
    if (!res.ok) setLedgerOpenError(res.error);
    else useProjectStore.getState().openTab({ path: res.path, content: res.content });
  };
  const testAll = async () => {
    setBatchError(null);
    const res = await useConjectureStore.getState().testAll(runId);
    if (!res.ok) setBatchError(res.error);
  };

  if (!available) {
    return <LabEmptyState icon={FlaskConical} title="The Conjecture Engine needs the desktop kernel" body="Conjectures are tested by the Python kernel with exact Pauli propagation, which the web build does not include." />;
  }

  return (
    <div className="cj-stack" role="region" aria-label="Conjectures">
      <ConjectureHeader
        digest={digest}
        blocker={blocker}
        proposing={state.proposing}
        error={state.proposeError}
        dropped={state.dropped}
        onPropose={() => void useConjectureStore.getState().propose(runId)}
        onCancel={() => useConjectureStore.getState().cancelPropose(runId)}
      />
      {state.proposing && state.proposals.length === 0 && (
        <div className="lab-stack" aria-busy="true" aria-label="Waiting for proposals"><LabSkeleton height={96} /><LabSkeleton height={96} /></div>
      )}
      {state.proposals.length === 0 && !state.proposing ? (
        <LabEmptyState
          compact
          icon={FlaskConical}
          title="No conjectures yet"
          body={blocker ? 'See the note above for what is missing.' : 'Propose conjectures to turn this archive into claims the kernel can try to break.'}
        />
      ) : (
        <>
          {state.proposals.length > 0 && (
            <div className="cj-actions">
              <LabButton disabled={anyActive || untestedAccepted === 0} onClick={() => void testAll()}>
                Test all accepted ({untestedAccepted})
              </LabButton>
              {batchError && <span className="lab-muted" role="status">{batchError}</span>}
            </div>
          )}
          {state.proposals.map((p) => (
            <ProposalCard key={p.conjecture.id} runId={runId} proposal={p} job={state.jobs[p.conjecture.id]} schema={schema} anyTestActive={anyActive && !isActiveJob(state.jobs[p.conjecture.id])} />
          ))}
        </>
      )}
      <LedgerList runId={runId} state={state.ledger} onOpenMarkdown={() => void openLedger()} openError={ledgerOpenError} />
      <LabCallout tone="info" title="How to read a verdict">
        Supported means no held-out circuit violated the prediction within its confidence interval. It is never a proof.
      </LabCallout>
    </div>
  );
}
