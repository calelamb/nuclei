import { useState } from 'react';
import { AlertTriangle, FileCode2, MonitorOff, Plus, RefreshCw } from 'lucide-react';
import {
  LabButton,
  LabCallout,
  LabEmptyState,
  LabSectionLabel,
  LabShell,
  LabShellBody,
  LabSkeleton,
  formatSci,
} from '../lab';
import { useDiscoveryStore, type DiscoveryDefinition } from '../../stores/discoveryStore';
import { runTimeLabel } from '../../services/discovery/format';
import type { RunRecord } from '../../types/discovery';
import { EvaluatorChip, RunStatusPill } from './pills';
import { useDiscoveryBoot } from './useDiscoveryBoot';
import './discovery.css';

const LIST_STYLE = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-1)' } as const;
const VISIBLE_RUNS = 4;

function RunRow({ run, selected, onSelect }: { run: RunRecord; selected: boolean; onSelect: () => void }) {
  const best = run.best_fitness_history[run.best_fitness_history.length - 1];
  return (
    <li>
      <button
        type="button"
        className="lab-button lab-button--ghost"
        aria-pressed={selected}
        aria-label={`Run ${runTimeLabel(run.run_id)}, ${run.status}`}
        onClick={onSelect}
        style={{ width: '100%', height: 'auto', flexWrap: 'wrap', justifyContent: 'flex-start', gap: '2px var(--space-2)', minHeight: 28, padding: '3px 8px', background: selected ? 'var(--lab-quantum-soft)' : undefined }}
      >
        <RunStatusPill status={run.status} />
        <span className="lab-mono" style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{runTimeLabel(run.run_id, true)}</span>
        <span className="lab-mono lab-muted" title="Best fitness">{best === undefined ? '—' : formatSci(best, 3)}</span>
      </button>
    </li>
  );
}

function DefinitionBlock({ definition, runs }: { definition: DiscoveryDefinition; runs: RunRecord[] }) {
  const selectedDefinition = useDiscoveryStore((s) => s.selectedDefinition);
  const selectedRunId = useDiscoveryStore((s) => s.selectedRunId);
  const selectDefinition = useDiscoveryStore((s) => s.selectDefinition);
  const selectRun = useDiscoveryStore((s) => s.selectRun);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? runs : runs.slice(0, VISIBLE_RUNS);
  const isSelected = selectedDefinition === definition.fileName && !selectedRunId;
  return (
    <li>
      <button
        type="button"
        className="lab-button lab-button--ghost"
        aria-pressed={isSelected}
        onClick={() => selectDefinition(definition.fileName)}
        style={{ width: '100%', height: 'auto', justifyContent: 'flex-start', alignItems: 'flex-start', gap: 'var(--space-2)', minHeight: 32, padding: '6px 10px', background: isSelected ? 'var(--lab-quantum-soft)' : undefined }}
      >
        <FileCode2 size={13} aria-hidden style={{ marginTop: 3 }} />
        <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4, justifyItems: 'start' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, maxWidth: '100%' }}>{definition.spec.name}</span>
          <EvaluatorChip kind={definition.spec.evaluator.kind} />
        </span>
      </button>
      {runs.length > 0 && (
        <ul aria-label={`Runs of ${definition.spec.name}`} style={{ ...LIST_STYLE, marginLeft: 'var(--space-4)', marginTop: 2 }}>
          {shown.map((run) => (
            <RunRow key={run.run_id} run={run} selected={run.run_id === selectedRunId} onSelect={() => void selectRun(run.run_id)} />
          ))}
          {runs.length > VISIBLE_RUNS && (
            <li>
              <LabButton variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer runs' : `Show all ${runs.length} runs`}
              </LabButton>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** Rail companion: discovery definitions with their runs, validation errors and New discovery. */
export function DiscoverySidebar() {
  const { unavailable, projectRoot } = useDiscoveryBoot();
  const definitions = useDiscoveryStore((s) => s.definitions);
  const validationErrors = useDiscoveryStore((s) => s.validationErrors);
  const runsByDefinition = useDiscoveryStore((s) => s.runsByDefinition);
  const loading = useDiscoveryStore((s) => s.loading);
  const openWizard = useDiscoveryStore((s) => s.openWizard);
  const reload = useDiscoveryStore((s) => s.reload);

  const empty = definitions.length === 0 && validationErrors.length === 0;

  let body;
  if (unavailable) {
    body = <LabEmptyState compact icon={MonitorOff} title="Needs the desktop kernel" body={`${unavailable.message} Open Nuclei on the desktop to run discovery searches.`} />;
  } else if (!projectRoot) {
    body = <LabEmptyState compact icon={FileCode2} title="Open a project" body="Discovery definitions live in experiments/*.discovery.yaml inside a project folder." />;
  } else if (loading && empty) {
    body = (
      <div aria-busy="true" aria-label="Loading discovery definitions" style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <LabSkeleton height={32} />
        <LabSkeleton height={28} width="80%" />
        <LabSkeleton height={28} width="70%" />
      </div>
    );
  } else if (empty) {
    body = (
      <LabEmptyState
        compact
        icon={FileCode2}
        title="No discovery definitions yet"
        body="Start from a template and the engine writes the YAML and a seed program for you."
        actions={<LabButton variant="primary" icon={Plus} onClick={openWizard}>New discovery</LabButton>}
      />
    );
  } else {
    body = (
      <ul aria-label="Discovery definitions" style={{ ...LIST_STYLE, gap: 'var(--space-2)' }}>
        {definitions.map((d) => (
          <DefinitionBlock key={d.fileName} definition={d} runs={runsByDefinition[d.fileName] ?? []} />
        ))}
      </ul>
    );
  }

  return (
    <LabShell label="Discovery Engine sidebar" className="disc-root">
      <LabShellBody>
        <div className="lab-stack">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div style={{ flex: 1 }}>
              <LabSectionLabel>Discoveries</LabSectionLabel>
            </div>
            <LabButton variant="ghost" iconOnly icon={RefreshCw} aria-label="Refresh discoveries" disabled={!projectRoot || !!unavailable || loading} onClick={() => projectRoot && void reload(projectRoot)} />
          </div>
          <LabButton variant="primary" size="md" icon={Plus} disabled={!projectRoot || !!unavailable} onClick={openWizard} style={{ width: '100%' }}>
            New discovery
          </LabButton>
          {body}
          {validationErrors.length > 0 && (
            <section aria-label="Invalid discovery files" className="lab-stack">
              <LabSectionLabel>
                <AlertTriangle size={11} aria-hidden /> Needs attention
              </LabSectionLabel>
              {validationErrors.map((e) => (
                <LabCallout key={e.path} tone="danger" title={<span className="lab-mono">{e.fileName}</span>}>
                  <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
                    {e.errors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </LabCallout>
              ))}
            </section>
          )}
        </div>
      </LabShellBody>
    </LabShell>
  );
}
