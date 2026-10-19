import { useState } from 'react';
import { BadgeCheck, FileOutput, ShieldCheck } from 'lucide-react';
import { LabButton, LabCallout, LabCard, LabEmptyState, LabPill, formatInterval, formatSci } from '../lab';
import { FRONTIER_HONESTY } from '../../services/discovery/honesty';
import { useDiscoveryStore, type RunView } from '../../stores/discoveryStore';
import { ProgramDiff } from './ProgramDiff';

type Notice = { tone: 'success' | 'danger'; text: string } | null;

function ConfirmedBlock({ view }: { view: RunView }) {
  const confirmation = view.run.confirmation;
  if (!confirmation) return null;
  if (confirmation.rejection) {
    return (
      <LabCallout tone="danger" title="Champion rejected at confirmation">
        Champion rejected at confirmation: {confirmation.rejection}. No confirmed numbers are reported.
      </LabCallout>
    );
  }
  return (
    <section aria-label="Confirmed on fresh seeds" className="lab-stack" style={{ gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <LabPill tone="success" icon={BadgeCheck}>Confirmed</LabPill>
        <span className="lab-muted">{confirmation.n_scored} of {confirmation.seeds.length} fresh seeds scored</span>
      </div>
      <dl className="disc-counts" style={{ gridTemplateColumns: '1fr' }}>
        <div>
          <dt>Fitness (mean ± CI)</dt>
          <dd>{formatSci(confirmation.fitness_mean)} {formatInterval(confirmation.fitness_ci95)}</dd>
        </div>
        {confirmation.fitness_drop !== null && (
          <div title="Original fitness minus the confirmed mean: the winner's-curse estimate">
            <dt>Drop vs search score</dt>
            <dd>{formatSci(confirmation.fitness_drop)}</dd>
          </div>
        )}
        {confirmation.objectives.map((o) => (
          <div key={o.key}>
            <dt>{o.label}</dt>
            <dd>{formatSci(o.mean)} {o.ci95 ? formatInterval(o.ci95) : '(n < 2)'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The run's champion: diff against the seed, Promote, and confirmation on fresh seeds. */
export function ChampionCard({ view, onOpen }: { view: RunView; onOpen: (id: string) => void }) {
  const { run } = view;
  const champion = run.champion_id ? view.candidates[run.champion_id] : undefined;
  const seed = view.candidates['c-0000'];
  const live = useDiscoveryStore((s) => s.liveRunIds.includes(run.run_id));
  const confirming = useDiscoveryStore((s) => !!s.pendingActions[`${run.run_id}:confirm`]);
  const promoteCandidate = useDiscoveryStore((s) => s.promoteCandidate);
  const confirmChampion = useDiscoveryStore((s) => s.confirmChampion);
  const [notice, setNotice] = useState<Notice>(null);
  const frontier = run.spec.evaluator.kind === 'trainability_frontier';

  if (!champion || !seed) {
    return (
      <LabCard title="Champion">
        <LabEmptyState compact title="No champion yet" body={run.status === 'running' ? 'The first scored candidate becomes the champion.' : run.message?.startsWith('no confirmed champion') ? run.message : 'No candidate has been scored in this run.'} />
      </LabCard>
    );
  }

  const isSeed = champion.id === seed.id;
  const confirmDisabled = live || confirming || run.spec.confirm.seeds === 0;
  const confirmTitle = live ? 'Wait for the run to finish or stop it first' : run.spec.confirm.seeds === 0 ? 'confirm.seeds is 0 in the definition' : undefined;

  const promote = async () => {
    const res = await promoteCandidate(run.run_id, champion.id);
    setNotice(res.ok ? { tone: 'success', text: `Wrote ${res.path}` } : { tone: 'danger', text: res.error });
  };
  const confirm = async () => {
    const res = await confirmChampion(run.run_id);
    setNotice(res.ok ? { tone: 'success', text: 'Champion re-evaluated on fresh seeds.' } : { tone: 'danger', text: res.error });
  };

  return (
    <LabCard
      title={`Champion ${champion.id}`}
      subtitle={isSeed ? 'The seed is still the best candidate' : `Generation ${champion.generation}, island ${champion.island + 1}, ${champion.mutator.toUpperCase()}`}
      actions={
        <>
          <LabButton size="sm" variant="ghost" onClick={() => onOpen(champion.id)}>Details</LabButton>
          <LabButton size="sm" icon={FileOutput} onClick={() => void promote()}>Promote</LabButton>
          <LabButton size="sm" variant="primary" icon={ShieldCheck} disabled={confirmDisabled} title={confirmTitle} onClick={() => void confirm()}>
            {confirming ? 'Confirming…' : 'Confirm on fresh seeds'}
          </LabButton>
        </>
      }
    >
      <div className="lab-stack">
        <div className="lab-mono" style={{ fontSize: 20, fontWeight: 600 }}>{formatSci(champion.evaluation?.fitness)} <span className="lab-muted" style={{ fontSize: 12, fontWeight: 400 }}>fitness (seed {formatSci(run.seed_fitness)})</span></div>
        {notice && <LabCallout tone={notice.tone}>{notice.text}</LabCallout>}
        <ConfirmedBlock view={view} />
        {!run.confirmation && <p className="lab-muted" style={{ margin: 0 }}>Not yet confirmed. Search scores are the maximum over many candidates, so they are optimistic; confirm re-runs the champion on fresh seeds.</p>}
        {frontier && <LabCallout tone="info">{FRONTIER_HONESTY}</LabCallout>}
        {!isSeed && <ProgramDiff label="Champion diff against the seed" original={seed.program} modified={champion.program} />}
      </div>
    </LabCard>
  );
}
