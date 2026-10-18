import { Play } from 'lucide-react';
import { LabButton, LabCallout, LabCard, LabEmptyState, LabPill } from '../lab';
import { runTimeLabel } from '../../services/discovery/format';
import { FRONTIER_CONTEXT, FRONTIER_HONESTY, FRONTIER_QUESTION, RED_QUEEN_EXPLAINER } from '../../services/discovery/honesty';
import { useDiracStore } from '../../stores/diracStore';
import { useDiscoveryStore, type DiscoveryDefinition } from '../../stores/discoveryStore';
import { Facts } from './drawerSections';
import { EvaluatorChip, MutatorChip, RunStatusPill } from './pills';

/** A selected definition with no run open: its settings, Start, and its past runs. */
export function DefinitionPanel({ definition }: { definition: DiscoveryDefinition }) {
  const { spec } = definition;
  const runs = useDiscoveryStore((s) => s.runsByDefinition[definition.fileName] ?? []);
  const anyLive = useDiscoveryStore((s) => s.liveRunIds.length > 0);
  const evaluatorsError = useDiscoveryStore((s) => s.evaluatorsError);
  const starting = useDiscoveryStore((s) => s.startRun);
  const selectRun = useDiscoveryStore((s) => s.selectRun);
  const hasKey = useDiracStore((s) => !!s.apiKey);
  const frontier = spec.evaluator.kind === 'trainability_frontier';
  const usesLlm = spec.mutator.kind !== 'ast';
  const needsKey = spec.mutator.kind === 'llm' || spec.mutator.kind === 'red_queen';
  const { budget, search, mutator } = spec;

  return (
    <div className="lab-stack">
      <LabCard
        title={spec.name}
        subtitle={spec.description || definition.fileName}
        actions={
          <LabButton variant="primary" size="md" icon={Play} disabled={anyLive || (needsKey && !hasKey)} title={anyLive ? 'A discovery run is already active' : undefined} onClick={() => void starting(definition.fileName)}>
            Start run
          </LabButton>
        }
      >
        <div className="lab-stack">
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <EvaluatorChip kind={spec.evaluator.kind} />
            <MutatorChip kind={mutator.kind} breadth={mutator.models.breadth} depth={mutator.models.depth} />
            {frontier && <LabPill tone="dirac">Research instrument</LabPill>}
          </div>
          {frontier && (
            <LabCallout tone="info" title={`Open question: ${FRONTIER_QUESTION}`}>
              {FRONTIER_CONTEXT} {FRONTIER_HONESTY}
            </LabCallout>
          )}
          {spec.mutator.kind === 'red_queen' && (
            <LabCallout tone="warning" title="Red Queen mode">{RED_QUEEN_EXPLAINER}</LabCallout>
          )}
          {usesLlm && !hasKey && (
            <LabCallout tone="warning" title="No API key set">
              {needsKey ? 'An LLM-only or Red Queen run cannot start without an Anthropic API key. Add one in Settings, or switch the mutator to hybrid or AST.' : 'Hybrid runs will fall back to the AST mutator until an Anthropic API key is added in Settings.'}
            </LabCallout>
          )}
          {evaluatorsError && <LabCallout tone="warning" title="The kernel's evaluators could not be listed">{evaluatorsError}</LabCallout>}
          <Facts
            rows={[
              ['Seed program', <code key="p" className="lab-mono">{spec.program}</code>],
              ['Islands × generations', `${search.islands} × ${search.generations}`],
              ['Candidates per generation', search.candidates_per_generation],
              ['Max evaluations', budget.max_evaluations],
              ['Max LLM calls', budget.max_llm_calls],
              ['Max wall time', `${budget.max_wall_minutes} min`],
              ['Confirmation seeds', spec.confirm.seeds],
              ['Cascade', spec.evaluation.cascade ? 'screen, then full' : 'full only'],
            ]}
          />
          {spec.notes && <p className="lab-muted" style={{ margin: 0 }}>{spec.notes}</p>}
        </div>
      </LabCard>
      <LabCard title="Runs" flush>
        {runs.length === 0 ? (
          <LabEmptyState compact title="No runs yet" body="Start a run to see the fitness trajectory, lineage, archive and guardrail log." />
        ) : (
          <ul aria-label="Runs" style={{ listStyle: 'none', margin: 0, padding: 'var(--space-2)', display: 'grid', gap: 2 }}>
            {runs.map((run) => (
              <li key={run.run_id}>
                <button type="button" className="lab-button lab-button--ghost" style={{ width: '100%', justifyContent: 'flex-start', gap: 'var(--space-3)' }} onClick={() => void selectRun(run.run_id)}>
                  <RunStatusPill status={run.status} />
                  <span className="lab-mono">{runTimeLabel(run.run_id)}</span>
                  <span className="lab-muted">{run.usage.evaluations} evaluations</span>
                  {run.confirmation && <LabPill tone="success" outline>confirmed</LabPill>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </LabCard>
    </div>
  );
}
