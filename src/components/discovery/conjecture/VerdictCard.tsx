import { useMemo, useState } from 'react';
import { FileCode2 } from 'lucide-react';
import { LabButton, LabCallout, LabSectionLabel, formatDuration } from '../../lab';
import { honestSummary } from '../../../services/conjecture/describe';
import { normalizeEvidence } from '../../../services/conjecture/evidence';
import { useConjectureStore } from '../../../stores/conjectureStore';
import { useProjectStore } from '../../../stores/projectStore';
import type { Conjecture, ConjectureResult, Counterexample, EvidenceRow } from '../../../types/conjecture';
import { EvidenceList } from './EvidenceList';
import { VerdictPill } from './pills';
import { ScalingChart } from './ScalingChart';

function CounterexampleCard({ runId, conjecture, cx, index }: { runId: string; conjecture: Conjecture; cx: Counterexample; index: number }) {
  const writeCounterexample = useConjectureStore((s) => s.writeCounterexample);
  const [state, setState] = useState<{ busy: boolean; error: string | null; path: string | null }>({ busy: false, error: null, path: null });
  const open = async () => {
    setState({ busy: true, error: null, path: null });
    const res = await writeCounterexample(runId, conjecture.id, index);
    if (!res.ok) {
      setState({ busy: false, error: res.error, path: null });
      return;
    }
    useProjectStore.getState().openTab({ path: res.path, content: res.code });
    setState({ busy: false, error: null, path: res.path });
  };
  const params = Object.entries(cx.family_params).map(([k, v]) => `${k.replace(/_/g, ' ')} ${Array.isArray(v) ? v.join(',') : String(v)}`).join(', ');
  return (
    <div className="cj-counterexample" role="group" aria-label={`Counterexample ${index + 1}`}>
      <strong>Counterexample {index + 1}</strong>
      <dl className="cj-meta">
        <dt>Circuit family</dt>
        <dd>{params || 'not reported'}</dd>
        <dt>Regenerate with seed</dt>
        <dd>{cx.regenerate.seed} (variant {cx.regenerate.variant})</dd>
      </dl>
      <div className="cj-actions">
        <LabButton size="sm" icon={FileCode2} disabled={state.busy} onClick={() => void open()}>
          Open counterexample as file
        </LabButton>
        {state.path && <span className="lab-mono lab-dim" role="status">Saved to {state.path}</span>}
      </div>
      {state.error && <LabCallout tone="danger">{state.error}</LabCallout>}
    </div>
  );
}

/** The verdict, in the honest wording: evidence on N held-out circuits up to n, never "proven". */
export function VerdictCard({ runId, conjecture, result, rows, ledgerError }: {
  runId: string;
  conjecture: Conjecture;
  result: ConjectureResult;
  rows?: EvidenceRow[];
  ledgerError?: string | null;
}) {
  const evidence = useMemo(() => rows ?? result.evidence.map((item, i) => normalizeEvidence(item, i)), [rows, result]);
  const rawSummary = honestSummary(result.summary, result.verdict, evidence.length || conjecture.circuits, conjecture.n_range[1]);
  // The pill already says "Inconclusive"; do not repeat it as the sentence's first word.
  const summary = result.verdict === 'inconclusive' ? rawSummary.replace(/^Inconclusive:\s*/i, '') : rawSummary;
  // Reasons the summary already states are not repeated.
  const reasons = result.reasons.filter((r) => !summary.toLowerCase().includes(r.toLowerCase()));
  return (
    <div className="cj-verdict" data-verdict={result.verdict} role="region" aria-label={`Verdict: ${result.verdict}`}>
      <div className="lab-row">
        <VerdictPill verdict={result.verdict} />
        <span className="lab-muted" style={{ fontSize: 12 }}>
          {evidence.length} held-out circuits · {formatDuration(result.timings.elapsed_ms)}
        </span>
      </div>
      <p className="cj-verdict__summary">{summary}</p>
      {reasons.length > 0 && <p className="cj-caption">{reasons.join('; ')}.</p>}
      <p className="cj-caption">
        {result.verdict === 'supported'
          ? 'Supported is evidence on the circuits tested, not a proof for every circuit that fits the predicate.'
          : result.verdict === 'refuted'
            ? 'One violating held-out circuit is enough to refute the claim as stated.'
            : 'At least one circuit could not be decided within the exactness budget, so no verdict either way.'}
      </p>
      {result.counterexamples.length > 0 && (
        <div className="lab-stack" style={{ gap: 'var(--space-2)' }}>
          <LabSectionLabel>Counterexamples</LabSectionLabel>
          {result.counterexamples.map((cx, i) => <CounterexampleCard key={i} runId={runId} conjecture={conjecture} cx={cx} index={i} />)}
        </div>
      )}
      <ScalingChart rows={evidence} />
      <EvidenceList rows={evidence} />
      <p className="cj-caption lab-mono" title={result.fingerprint}>
        {result.fingerprint ? `Evaluator fingerprint ${result.fingerprint.slice(0, 16)} · ` : 'Evaluator fingerprint not reported · '}
        {formatDuration(result.timings.elapsed_ms)} total
      </p>
      {result.partial && (
        <LabCallout tone="warning" title="Partial result">
          {result.error?.message ?? result.reasons.join('; ') ?? 'The test stopped early.'} The verdict covers only the circuits finished before it stopped.
        </LabCallout>
      )}
      {ledgerError && <LabCallout tone="warning" title="Result not saved to the ledger">{ledgerError}</LabCallout>}
    </div>
  );
}
