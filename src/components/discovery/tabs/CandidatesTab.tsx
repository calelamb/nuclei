import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { LabButton, LabCard, LabEmptyState, LabInput, LabSelect, formatSci } from '../../lab';
import { DEFAULT_FILTER, filterCandidates, sortCandidates, type CandidateFilter, type SortDir, type SortKey } from '../../../services/discovery/candidateTable';
import { CANDIDATE_KIND_LABEL, candidateFitness, candidateKind, primaryObjectiveKey } from '../../../services/discovery/candidateView';
import type { RunView } from '../../../services/discovery/runView';
import { useCandidateList } from '../useCandidateList';
import { CandidateKindPill } from '../pills';

const PAGE = 100;

interface Column {
  key: SortKey;
  label: string;
  numeric?: boolean;
}

export function CandidatesTab({ view, selectedId, onOpen }: { view: RunView; selectedId: string | null; onOpen: (id: string) => void }) {
  const list = useCandidateList(view);
  const objectiveKey = primaryObjectiveKey(view.run);
  const objectiveLabel = view.run.archive.objectives[0]?.label ?? 'Objective';
  const [filter, setFilter] = useState<CandidateFilter>(DEFAULT_FILTER);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'id', dir: 'asc' });
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => sortCandidates(filterCandidates(list, filter), sort.key, sort.dir, objectiveKey), [list, filter, sort, objectiveKey]);
  const shown = rows.slice(0, limit);
  const islands = view.run.spec.search.islands;
  const columns: Column[] = [
    { key: 'id', label: 'Candidate' },
    { key: 'island', label: 'Island', numeric: true },
    { key: 'generation', label: 'Gen', numeric: true },
    { key: 'mutator', label: 'Mutator' },
    { key: 'status', label: 'Status' },
    { key: 'fitness', label: 'Fitness', numeric: true },
    { key: 'objective', label: objectiveLabel, numeric: true },
  ];
  const patch = (next: Partial<CandidateFilter>) => {
    setFilter((f) => ({ ...f, ...next }));
    setLimit(PAGE);
  };
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'fitness' ? 'desc' : 'asc' }));

  return (
    <LabCard
      title="Candidates"
      subtitle={`${rows.length} of ${list.length} candidates`}
      flush
      actions={
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }} role="group" aria-label="Candidate filters">
          <LabInput aria-label="Search candidate id" placeholder="Search id" value={filter.query} onChange={(e) => patch({ query: e.target.value })} style={{ width: 120 }} />
          <LabSelect aria-label="Filter by status" value={filter.status} onChange={(e) => patch({ status: e.target.value as CandidateFilter['status'] })}>
            <option value="all">All statuses</option>
            {Object.entries(CANDIDATE_KIND_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </LabSelect>
          <LabSelect aria-label="Filter by mutator" value={filter.mutator} onChange={(e) => patch({ mutator: e.target.value as CandidateFilter['mutator'] })}>
            <option value="all">All mutators</option>
            <option value="llm">LLM</option>
            <option value="ast">AST</option>
            <option value="seed">Seed</option>
          </LabSelect>
          <LabSelect aria-label="Filter by island" value={filter.island} onChange={(e) => patch({ island: e.target.value })}>
            <option value="all">All islands</option>
            {Array.from({ length: islands }, (_, i) => <option key={i} value={String(i)}>Island {i + 1}</option>)}
          </LabSelect>
        </div>
      }
    >
      {list.length === 0 ? (
        <LabEmptyState compact title="No candidates yet" body="The seed program and every proposal show up here as the search runs." />
      ) : rows.length === 0 ? (
        <LabEmptyState compact title="No candidates match these filters" actions={<LabButton onClick={() => patch(DEFAULT_FILTER)}>Clear filters</LabButton>} />
      ) : (
        <div style={{ overflow: 'auto', maxHeight: 520 }}>
          <table className="lab-table" aria-label="Candidates">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.numeric ? 'lab-num' : undefined} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => toggleSort(c.key)} style={{ minHeight: 28 }}>
                      {c.label}
                      {sort.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
                    </button>
                  </th>
                ))}
                <th>Parent</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const fitness = candidateFitness(c);
                const objective = objectiveKey ? c.evaluation?.objectives[objectiveKey]?.value : undefined;
                return (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    aria-selected={c.id === selectedId}
                    onClick={() => onOpen(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpen(c.id);
                      }
                    }}
                  >
                    <td className="lab-mono">{c.id}</td>
                    <td className="lab-num">{c.island + 1}</td>
                    <td className="lab-num">{c.generation}</td>
                    <td>{c.mutator.toUpperCase()}</td>
                    <td><CandidateKindPill kind={candidateKind(c)} /></td>
                    <td className="lab-num">{formatSci(fitness)}</td>
                    <td className="lab-num">{formatSci(objective)}</td>
                    <td className="lab-mono lab-muted">{c.parent_id ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > shown.length && (
            <div style={{ padding: 'var(--space-2) var(--space-4)' }}>
              <LabButton onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown.length)} more</LabButton>
            </div>
          )}
        </div>
      )}
    </LabCard>
  );
}
