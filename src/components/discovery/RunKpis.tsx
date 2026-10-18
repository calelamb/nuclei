import { Activity, Coins, Gauge, Percent, Share2, ShieldAlert, Trophy } from 'lucide-react';
import { LabKpi, LabKpiStrip, formatInterval, formatPct, formatSci } from '../lab';
import type { DiscoveryKpis } from '../../stores/discoveryStore';
import { SEED_EXCLUDED_NOTE, formatCount, signed } from '../../services/discovery/format';

const SEGMENTS = [
  { key: 'scored', label: 'scored', color: 'var(--color-success)' },
  { key: 'rejected', label: 'rejected', color: 'var(--color-danger)' },
  { key: 'failed', label: 'failed', color: 'var(--color-warning)' },
  { key: 'screenedOut', label: 'screened out', color: 'var(--color-text-tertiary)' },
  { key: 'duplicate', label: 'duplicate', color: 'var(--lab-axis)' },
] as const;

function EvaluationsTile({ kpis }: { kpis: DiscoveryKpis }) {
  const total = SEGMENTS.reduce((sum, s) => sum + kpis.counts[s.key], 0);
  return (
    <div className="lab-kpi" aria-label="Evaluations breakdown">
      <div className="lab-kpi__label"><Activity size={12} aria-hidden /><span>Evaluations</span></div>
      <div className="lab-kpi__value">{formatCount(kpis.evaluations)}</div>
      <div className="disc-stack-bar" aria-hidden>
        {total > 0 && SEGMENTS.map((s) => (kpis.counts[s.key] > 0 ? <span key={s.key} style={{ flexGrow: kpis.counts[s.key], background: s.color }} /> : null))}
      </div>
      <div className="lab-dim" style={{ fontSize: 11 }}>outcomes {SEED_EXCLUDED_NOTE}</div>
      <ul className="disc-inline-counts" aria-label="Evaluation outcomes">
        {SEGMENTS.map((s) => (
          <li key={s.key}><b>{kpis.counts[s.key]}</b> {s.label}</li>
        ))}
      </ul>
    </div>
  );
}

/** Best fitness, champion objective (with the confirmed value), evaluations, acceptance, improvement share, tokens. */
export function RunKpis({ kpis, redQueen = false }: { kpis: DiscoveryKpis; redQueen?: boolean }) {
  const objective = kpis.championObjective;
  const confirmed = kpis.confirmedObjective;
  const share = kpis.improvementShare;
  return (
    <LabKpiStrip label="Run KPIs">
      <LabKpi
        icon={Trophy}
        label="Best fitness"
        value={formatSci(kpis.bestFitness)}
        delta={kpis.bestDelta === null ? null : { text: `${signed(kpis.bestDelta, (v) => formatSci(v))} vs seed`, direction: kpis.bestDelta > 0 ? 'up' : kpis.bestDelta < 0 ? 'down' : 'flat', good: kpis.bestDelta > 0 }}
        detail={kpis.bestDelta === null || kpis.bestDelta === 0 ? `seed ${formatSci(kpis.seedFitness)}` : undefined}
        title="Higher fitness is better. Fitness uses the pessimistic bound of each objective."
      />
      <LabKpi
        icon={Gauge}
        label={objective ? `Champion ${objective.label.toLowerCase()}` : 'Champion objective'}
        value={objective ? formatSci(objective.value.value) : '—'}
        detail={
          objective ? (
            <>
              {objective.value.ci95 ? `95% CI ${formatInterval(objective.value.ci95)}` : 'no interval'}
              <br />
              {confirmed ? (
                <strong>
                  confirmed {formatSci(confirmed.mean)} {confirmed.ci95 ? `± ${formatSci((confirmed.ci95[1] - confirmed.ci95[0]) / 2, 2)}` : '(n < 2)'}
                </strong>
              ) : (
                'not yet confirmed'
              )}
            </>
          ) : (
            'no champion yet'
          )
        }
        title="The champion's primary objective, and its mean on fresh seeds once confirmed."
      />
      <EvaluationsTile kpis={kpis} />
      <LabKpi icon={Percent} label="Acceptance rate" value={formatPct(kpis.acceptanceRate, 0)} detail="entered the archive" title="Share of evaluated candidates that entered the MAP-Elites archive." />
      {redQueen ? (
        <LabKpi
          icon={ShieldAlert}
          label="Exploits"
          value={String(kpis.audits.exploits)}
          detail={`${kpis.audits.run} audit${kpis.audits.run === 1 ? '' : 's'} · ${kpis.audits.consistent} consistent · ${kpis.audits.inconclusive} inconclusive`}
          title="Programs the evaluator scored well but the independent audit rejected. Red Queen mode only."
        />
      ) : (
      <LabKpi
        icon={Share2}
        label="Improvements by mutator"
        value={share ? `${formatPct(share.llm, 0)} LLM` : '—'}
        detail={share ? `${kpis.improvements.llm} LLM · ${kpis.improvements.ast} AST` : 'no improvements yet'}
        title="Share of improving children produced by the LLM mutator versus the AST baseline."
      />
      )}
      <LabKpi
        icon={Coins}
        label="Tokens"
        value={formatCount(kpis.tokens.total)}
        detail={`${formatCount(kpis.tokens.input)} in · ${formatCount(kpis.tokens.output)} out · ${formatCount(kpis.tokens.cacheRead)} cached`}
        title={`${kpis.llmCalls} LLM calls`}
      />
    </LabKpiStrip>
  );
}
