import { useId, useMemo, useState } from 'react';
import { LabEmptyState, LabSkeleton, LabTooltip, TooltipRows, RampLegend, formatSci, seqColor, type LabTooltipState } from '../lab';
import { LABEL_WIDTH, LAYER_SPACING, PADDING, WIRE_SPACING } from '../circuit/gates';
import { Cpu } from 'lucide-react';
import type { CircuitSnapshot } from '../../types/quantum';
import type { GradientStatistics, TrainabilityInspection } from '../../types/trainability';
import { buildHeatmapModel, type GateOverlay } from './heatmapMath';
import { GateGlyph } from './GateGlyphs';
import { GLYPH_SIZE, gateX, glyphBounds, wireY } from './glyphGeometry';

/**
 * The circuit with each parameterized gate tinted by log-scale Var[∂C/∂θ]
 * (Lab sequential ramp). Dead gates get a hatched gray treatment. Read-only:
 * the snapshot comes from `circuitStore` but is never written back.
 */
export function GradientHeatmapCircuit({
  snapshot,
  inspection,
  gradients,
  loading = false,
}: {
  snapshot: CircuitSnapshot | null;
  inspection: TrainabilityInspection | null;
  gradients: GradientStatistics | undefined;
  loading?: boolean;
}) {
  const hatchId = useId();
  const [tooltip, setTooltip] = useState<LabTooltipState | null>(null);
  const model = useMemo(
    () => buildHeatmapModel(snapshot?.gates ?? [], inspection, gradients),
    [snapshot, inspection, gradients],
  );

  if (loading && !snapshot) return <LabSkeleton height={160} />;
  if (!snapshot || snapshot.gates.length === 0) {
    return (
      <LabEmptyState
        icon={Cpu}
        title="No circuit to paint yet"
        body="Run or parse the active file so the circuit appears here; the gradient heatmap overlays its parameterized gates."
        compact
      />
    );
  }

  const { qubit_count, depth, gates } = snapshot;
  const svgWidth = LABEL_WIDTH + depth * LAYER_SPACING + PADDING * 2;
  const svgHeight = PADDING * 2 + (qubit_count - 1) * WIRE_SPACING + GLYPH_SIZE / 2;
  const measured = model.measuredCount > 0;

  const showTip = (overlay: GateOverlay, x: number, y: number) =>
    setTooltip({
      x,
      y,
      content: (
        <TooltipRows
          title={overlay.parameter}
          rows={[
            { label: 'Var[∂C/∂θ]', value: overlay.variance === null ? 'not measured' : formatSci(overlay.variance, 3) },
            { label: 'E|∂C/∂θ|', value: overlay.absMean === null ? '—' : formatSci(overlay.absMean, 3) },
            ...(overlay.dead ? [{ label: 'Status', value: 'dead (≈ zero variance)' }] : []),
          ]}
        />
      ),
    });

  const summary = !measured
    ? `Circuit with ${model.overlays.length} parameterized gates. Run the gradient analysis to tint them.`
    : `Gradient heatmap: ${model.measuredCount} of ${model.overlays.length} parameterized gates measured, ${model.deadCount} dead. Variance ranges from ${formatSci(10 ** (model.domain?.[0] ?? 0), 2)} to ${formatSci(10 ** (model.domain?.[1] ?? 0), 2)}.`;

  return (
    <div className="lab-stack" style={{ gap: 'var(--space-2)' }}>
      <div style={{ overflow: 'auto', maxHeight: 340 }} role="region" aria-label="Circuit gradient heatmap" tabIndex={0}>
        <svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} role="img" aria-label="Circuit with gradient variance heatmap">
          <defs>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" style={{ fill: 'var(--lab-surface-3)' }} />
              <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--color-text-tertiary)', strokeWidth: 1.5 }} />
            </pattern>
          </defs>
          {Array.from({ length: qubit_count }, (_, q) => (
            <g key={`w${q}`}>
              <line x1={LABEL_WIDTH - 10} x2={svgWidth - PADDING} y1={wireY(q)} y2={wireY(q)} style={{ stroke: 'var(--lab-axis)', strokeWidth: 1.2 }} />
              <text
                x={LABEL_WIDTH - 18}
                y={wireY(q)}
                textAnchor="end"
                dominantBaseline="central"
                style={{ fill: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}
              >
                q{q}
              </text>
            </g>
          ))}
          {gates.map((gate, index) => {
            const overlay = model.byGateIndex.get(index);
            if (!overlay) {
              return (
                <g key={`g${index}`} style={{ opacity: model.overlays.length > 0 ? 0.55 : 1 }}>
                  <GateGlyph gate={gate} />
                </g>
              );
            }
            const b = glyphBounds(gate);
            const fill = overlay.dead ? `url(#${hatchId})` : overlay.t === null ? 'var(--lab-surface-3)' : seqColor(overlay.t);
            const label = `${overlay.parameter}: ${
              overlay.variance === null ? 'variance not measured' : overlay.dead ? 'dead gate' : `variance ${formatSci(overlay.variance, 3)}`
            }`;
            return (
              <g
                key={`g${index}`}
                tabIndex={0}
                role="img"
                aria-label={label}
                style={{ cursor: 'default', outline: 'none' }}
                className="trainability-gate"
                onPointerEnter={(e) => showTip(overlay, e.clientX, e.clientY)}
                onPointerMove={(e) => showTip(overlay, e.clientX, e.clientY)}
                onPointerLeave={() => setTooltip(null)}
                onFocus={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  showTip(overlay, r.right, r.top);
                }}
                onBlur={() => setTooltip(null)}
              >
                <rect
                  x={b.x}
                  y={b.y}
                  width={b.width}
                  height={b.height}
                  rx={5}
                  style={{
                    fill,
                    stroke: overlay.dead ? 'var(--color-text-tertiary)' : 'var(--color-accent-quantum)',
                    strokeWidth: overlay.t === null && !overlay.dead ? 1.2 : 1.6,
                    strokeDasharray: overlay.t === null && !overlay.dead ? '3 2' : undefined,
                  }}
                />
                <text
                  x={gateX(gate.layer)}
                  y={wireY(gate.targets[0] ?? 0)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fill: 'var(--color-text-primary)',
                    stroke: 'var(--lab-surface-2)',
                    strokeWidth: 3,
                    paintOrder: 'stroke',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10.5,
                  }}
                >
                  {gate.type.length > 5 ? `${gate.type.slice(0, 4)}…` : gate.type}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="lab-row" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        {measured && model.domain ? (
          <RampLegend
            label="Var[∂C/∂θ] (log)"
            low={formatSci(10 ** model.domain[0], 2)}
            high={formatSci(10 ** model.domain[1], 2)}
          />
        ) : (
          <span className="lab-muted">Gates with free parameters are outlined; run gradients to tint them.</span>
        )}
        <span className="lab-row" style={{ gap: 'var(--space-1)' }}>
          <svg width={16} height={12} aria-hidden>
            <rect width={16} height={12} rx={3} style={{ fill: 'var(--lab-surface-3)', stroke: 'var(--color-text-tertiary)' }} />
            <line x1={2} y1={10} x2={10} y2={2} style={{ stroke: 'var(--color-text-tertiary)' }} />
            <line x1={7} y1={11} x2={14} y2={4} style={{ stroke: 'var(--color-text-tertiary)' }} />
          </svg>
          <span className="lab-muted">dead gate (≈ zero variance){measured ? `: ${model.deadCount}` : ''}</span>
        </span>
      </div>
      <p className="lab-sr-only">{summary}</p>
      <LabTooltip state={tooltip} />
    </div>
  );
}
