import { useState } from 'react';
import { ChartFrame, LabButton, LabKpi, LabKpiStrip, LegendItem, formatInterval, formatSci } from '../../lab';
import { isFullRange, zoomedFidelityDomain } from './histogramMath';
import type { EntanglingCapabilityResult, ExpressibilityResult } from '../../../types/trainability';


export function ExpressibilityPanel({ data }: { data: ExpressibilityResult }) {
  const [fullRange, setFullRange] = useState(false);
  const zoom = zoomedFidelityDomain(data.histogram);
  const canZoom = !isFullRange(zoom);
  const domain: [number, number] = fullRange || !canZoom ? [0, 1] : zoom;
  const visible = data.histogram.filter((b) => b.lo < domain[1]);
  const fidelityAxis = { domain, nice: false, label: 'fidelity F', ticks: 5 };
  const maxMass = Math.max(1e-6, ...visible.flatMap((b) => [b.observed, b.haar]));
  const yAxis = { domain: [0, maxMass * 1.1] as [number, number], label: 'probability per bin', nice: true };
  const summary = `Fidelity distribution of ${data.pairs} random state pairs over ${data.bins} bins compared with the Haar distribution. KL divergence ${formatSci(data.kl)}, 95% CI ${formatInterval(data.kl_ci95)}.`;
  return (
    <div className="lab-stack">
      <LabKpiStrip label="Expressibility">
        <LabKpi label="KL to Haar" value={formatSci(data.kl)} detail={`95% CI ${formatInterval(data.kl_ci95)}`} title="Lower is more expressive (Sim et al. 2019)" />
        <LabKpi label="Idle reference" value={formatSci(data.reference.idle_kl)} detail="constant-output circuit" title={data.reference.note} />
        <LabKpi label="Pairs" value={data.pairs} detail={`${data.bins} bins, dim ${data.dimension}`} />
      </LabKpiStrip>
      {canZoom && (
        <div className="lab-row">
          <LabButton size="sm" variant="ghost" aria-pressed={fullRange} onClick={() => setFullRange((v) => !v)}>
            {fullRange ? 'Zoom to the data' : 'Show full range [0, 1]'}
          </LabButton>
          <span className="lab-muted">
            {fullRange ? 'Showing F from 0 to 1.' : `Zoomed to F in [0, ${formatSci(domain[1], 2)}], where the mass is.`}
          </span>
        </div>
      )}
      <ChartFrame
        x={fidelityAxis}
        y={yAxis}
        height={240}
        ariaLabel="Fidelity histogram against the Haar curve"
        summary={summary}
        legend={
          <>
            <LegendItem color="var(--color-accent-quantum)" shape="square" label="observed" />
            <LegendItem color="var(--lab-div-pos)" shape="line" label="Haar" />
          </>
        }
      >
        {({ x, y, innerHeight }) => (
          <g>
            {visible.map((b) => (
              <rect
                key={b.lo}
                x={x(b.lo) + 0.5}
                y={y(b.observed)}
                width={Math.max(1, x(b.hi) - x(b.lo) - 1)}
                height={Math.max(0, innerHeight - y(b.observed))}
                style={{ fill: 'var(--lab-quantum-soft)', stroke: 'var(--color-accent-quantum)', strokeWidth: 1 }}
              />
            ))}
            <polyline
              points={visible.map((b) => `${x((b.lo + b.hi) / 2)},${y(b.haar)}`).join(' ')}
              style={{ fill: 'none', stroke: 'var(--lab-div-pos)', strokeWidth: 2 }}
            />
          </g>
        )}
      </ChartFrame>
      <p className="lab-muted" style={{ margin: 0 }}>{data.reference.note}</p>
    </div>
  );
}

export function EntanglementPanel({ data }: { data: EntanglingCapabilityResult }) {
  const maxCount = Math.max(1, ...data.histogram.map((b) => b.count));
  const yAxis = { domain: [0, maxCount * 1.1] as [number, number], label: 'samples', nice: true };
  const xAxis = { domain: [0, 1] as [number, number], nice: false, label: 'Meyer–Wallach Q', ticks: 5 };
  const summary = `Meyer–Wallach entanglement of sampled states, mean ${formatSci(data.mean)} ± ${formatSci(data.std)}, 95% CI ${formatInterval(data.ci95)}; the Haar mean is ${formatSci(data.haar_mean)}.`;
  return (
    <div className="lab-stack">
      <LabKpiStrip label="Entangling capability">
        <LabKpi label="Mean Q" value={formatSci(data.mean)} detail={`± ${formatSci(data.std)} (1σ)`} />
        <LabKpi label="95% CI" value={formatInterval(data.ci95)} />
        <LabKpi label="Haar mean" value={formatSci(data.haar_mean)} detail="(2ⁿ − 2)/(2ⁿ + 1)" />
      </LabKpiStrip>
      <ChartFrame
        x={xAxis}
        y={yAxis}
        height={220}
        ariaLabel="Meyer–Wallach entanglement distribution"
        summary={summary}
        legend={
          <>
            <LegendItem color="var(--color-accent-quantum)" shape="square" label="sampled states" />
            <LegendItem color="var(--color-accent-quantum)" shape="line" label="circuit mean" />
            <LegendItem color="var(--lab-div-pos)" shape="line" label="Haar mean" />
          </>
        }
      >
        {({ x, y, innerHeight }) => (
          <g>
            {data.histogram.map((b) => (
              <rect
                key={b.lo}
                x={x(b.lo) + 0.5}
                y={y(b.count)}
                width={Math.max(1, x(b.hi) - x(b.lo) - 1)}
                height={Math.max(0, innerHeight - y(b.count))}
                style={{ fill: 'var(--lab-quantum-soft)', stroke: 'var(--color-accent-quantum)', strokeWidth: 1 }}
              />
            ))}
            <line x1={x(data.mean)} x2={x(data.mean)} y1={0} y2={innerHeight} style={{ stroke: 'var(--color-accent-quantum)', strokeWidth: 2 }} />
            <line x1={x(data.haar_mean)} x2={x(data.haar_mean)} y1={0} y2={innerHeight} style={{ stroke: 'var(--lab-div-pos)', strokeWidth: 2, strokeDasharray: '5 4' }} />
          </g>
        )}
      </ChartFrame>
    </div>
  );
}
