import { Pause, Play, RotateCcw, Square } from 'lucide-react';
import { LabButton, LabMeter, formatDuration } from '../lab';
import { useDiscoveryStore, type RunView } from '../../stores/discoveryStore';
import { formatCount } from '../../services/discovery/format';
import { redQueenConfig, summarizeAudits } from '../../services/discovery/redQueen';
import { candidateList } from '../../services/discovery/runView';
import { EvaluatorChip, MutatorChip, RunStatusPill } from './pills';

const RESUMABLE = new Set(['stale', 'paused', 'stopped', 'failed']);

/** Name, chips, status, controls and budget meters of the selected run. */
export function RunHeader({ view }: { view: RunView }) {
  const { run } = view;
  const live = useDiscoveryStore((s) => s.liveRunIds.includes(run.run_id));
  const anyLive = useDiscoveryStore((s) => s.liveRunIds.length > 0);
  const pauseRun = useDiscoveryStore((s) => s.pauseRun);
  const resumeRun = useDiscoveryStore((s) => s.resumeRun);
  const stopRun = useDiscoveryStore((s) => s.stopRun);
  const startRun = useDiscoveryStore((s) => s.startRun);
  const { spec, usage } = run;
  const mutator = spec.mutator;
  const redQueen = mutator.kind === 'red_queen';
  const audits = redQueen ? summarizeAudits(candidateList(view)) : null;
  const resumable = !live && RESUMABLE.has(run.status) && run.stop_reason !== 'seed_rejected';
  const blocked = anyLive && !live;
  const blockedTitle = blocked ? 'Another discovery run is active. Stop it or wait for it to finish.' : undefined;

  return (
    <section aria-label="Run header" data-mode={mutator.kind} className="lab-card" style={{ padding: 'var(--space-3) var(--space-4)', display: 'grid', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{spec.name}</h2>
        <EvaluatorChip kind={spec.evaluator.kind} />
        <MutatorChip kind={mutator.kind} breadth={mutator.models.breadth} depth={mutator.models.depth} />
        <RunStatusPill status={run.status} />
        <span className="lab-mono lab-dim" title="Run id">{run.run_id}</span>
        <div style={{ flex: 1 }} />
        <div role="group" aria-label="Run controls" style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {live && run.status === 'running' && (
            <LabButton size="md" icon={Pause} onClick={() => pauseRun(run.run_id)}>Pause</LabButton>
          )}
          {live && run.status === 'paused' && (
            <LabButton size="md" variant="primary" icon={Play} onClick={() => void resumeRun(run.run_id)}>Resume</LabButton>
          )}
          {live && (
            <LabButton size="md" variant="danger" icon={Square} onClick={() => stopRun(run.run_id)}>Stop</LabButton>
          )}
          {resumable && (
            <LabButton size="md" variant="primary" icon={Play} disabled={blocked} title={blockedTitle} onClick={() => void resumeRun(run.run_id)}>Resume</LabButton>
          )}
          {!live && (
            <LabButton size="md" icon={RotateCcw} disabled={blocked} title={blockedTitle ?? 'Start a fresh run of this definition'} onClick={() => void startRun(run.definition_file)}>
              New run
            </LabButton>
          )}
        </div>
      </div>
      <div className="lab-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <LabMeter label="Evaluations" value={usage.evaluations} max={spec.budget.max_evaluations} format={formatCount} />
        <LabMeter label="LLM calls" value={usage.llm_calls} max={spec.budget.max_llm_calls} format={formatCount} />
        {audits && <LabMeter label="Audits" value={audits.run + audits.pending + audits.errors} max={redQueenConfig(spec).max_audits} format={formatCount} />}
        <LabMeter label="Wall time" value={usage.wall_ms} max={spec.budget.max_wall_minutes * 60_000} format={formatDuration} />
      </div>
    </section>
  );
}
