import { useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { LabButton, LabCallout, LabCard, LabEmptyState, LabSegmented, LabSkeleton } from '../../lab';
import type { LedgerState } from '../../../services/conjecture/state';
import type { LedgerEntry } from '../../../types/conjecture';
import { VerdictPill } from './pills';
import { VerdictCard } from './VerdictCard';

type Verdict = 'supported' | 'refuted' | 'inconclusive' | 'failed';
type Filter = 'all' | Verdict;
const verdictOf = (e: LedgerEntry): Verdict => e.outcome === 'failed' ? 'failed' : (e.result?.verdict ?? 'failed');

export function LedgerList({ runId, state, onOpenMarkdown, openError }: {
  runId: string;
  state: LedgerState;
  onOpenMarkdown: () => void;
  openError: string | null;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const entries = useMemo(() => state.ledger?.entries ?? [], [state.ledger]);
  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: entries.length, supported: 0, refuted: 0, inconclusive: 0, failed: 0 };
    for (const e of entries) out[verdictOf(e)] += 1;
    return out;
  }, [entries]);
  const shown = entries.filter((e) => filter === 'all' || verdictOf(e) === filter);

  return (
    <LabCard
      title="Ledger"
      subtitle="Every conjecture tested on this run, including refuted ones. A negative result is a result."
      actions={<LabButton size="sm" icon={BookOpen} disabled={entries.length === 0} onClick={onOpenMarkdown}>Open ledger (.md)</LabButton>}
    >
      <div className="cj-stack">
        {state.error && <LabCallout tone="danger" title="Ledger problem">{state.error}</LabCallout>}
        {openError && <LabCallout tone="danger">{openError}</LabCallout>}
        {state.loading && entries.length === 0 ? (
          <div className="lab-stack" aria-busy="true" aria-label="Loading ledger"><LabSkeleton height={18} /><LabSkeleton height={18} width="70%" /></div>
        ) : entries.length === 0 ? (
          <LabEmptyState compact icon={BookOpen} title="No conjectures tested yet" body="Results are written to conjectures.json and conjectures.md in this run's folder as soon as a test finishes." />
        ) : (
          <>
            <LabSegmented<Filter>
              label="Filter ledger by verdict"
              idPrefix="cj-ledger"
              value={filter}
              onChange={setFilter}
              items={(['all', 'supported', 'refuted', 'inconclusive', 'failed'] as Filter[]).map((id) => ({ id, label: id === 'all' ? 'All' : id[0].toUpperCase() + id.slice(1), badge: counts[id] }))}
            />
            {shown.length === 0 ? (
              <p className="lab-muted" role="status">No {filter} conjectures in this ledger.</p>
            ) : (
              <table className="lab-table cj-ledger" aria-label="Conjecture ledger">
                <thead><tr><th>Verdict</th><th>Conjecture</th><th className="lab-num">n max</th><th>Tested</th><th><span className="lab-sr-only">Details</span></th></tr></thead>
                <tbody>
                  {shown.map((e) => (
                    <tr key={e.id} aria-selected={open === e.id}>
                      <td><VerdictPill verdict={verdictOf(e)} /></td>
                      <td><span className="lab-mono lab-dim">{e.id}</span><div>{e.conjecture.statement}</div>
                        {open === e.id && <>{e.error && <LabCallout tone="warning" title="The test did not finish">{e.error}</LabCallout>}{e.result && <VerdictCard runId={runId} conjecture={e.conjecture} result={e.result} />}</>}
                      </td>
                      <td className="lab-num">{e.conjecture.n_range[1]}</td>
                      <td className="lab-mono">{e.tested_at.slice(0, 16).replace('T', ' ')}</td>
                      <td><LabButton size="sm" variant="ghost" aria-expanded={open === e.id} aria-label={`${open === e.id ? 'Hide' : 'Show'} details for ${e.id}`} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'Details'}</LabButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </LabCard>
  );
}
