import { useId, useMemo, useState } from 'react';
import { Cpu } from 'lucide-react';
import { LabEmptyState, LabScrollArea, LabSkeleton, LabTooltip, TooltipRows, RampLegend, formatSci, type LabTooltipState } from '../lab';
import { LABEL_WIDTH, LAYER_SPACING, PADDING, WIRE_SPACING } from '../circuit/gates';
import type { CircuitSnapshot } from '../../types/quantum';
import type { GradientStatistics, TrainabilityInspection } from '../../types/trainability';
import { buildHeatmapModel, type GateOverlay, type HeatmapModel } from './heatmapMath';
import { GateGlyph } from './GateGlyphs';
import { GLYPH_SIZE, gateX, glyphBounds, wireY } from './glyphGeometry';
import { HeatmapGateTile } from './HeatmapGateTile';
import { overlayRows } from './heatmapTileLabels';

const STRIP_COLUMNS = 10;
const STRIP_TILE = { width: 56, height: 44, gap: 8 } as const;

/**
 * Hatch patterns: dead gates get a single-direction hatch, unresolved gates
 * (interval only, null variance) a cross-hatch, so the two never read alike.
 */
function Patterns({ dead, unresolved }: { dead: string; unresolved: string }) {
  return (
    <defs>
      <pattern id={dead} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" style={{ fill: 'var(--lab-surface-3)' }} />
        <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--color-text-tertiary)', strokeWidth: 1.5 }} />
      </pattern>
      <pattern id={unresolved} width="7" height="7" patternUnits="userSpaceOnUse">
        <rect width="7" height="7" style={{ fill: 'var(--lab-surface-3)' }} />
        <path d="M0 0L7 7M7 0L0 7" style={{ stroke: 'var(--color-text-tertiary)', strokeWidth: 1, fill: 'none' }} />
      </pattern>
    </defs>
  );
}

function summaryOf(model: HeatmapModel): string {
  if (model.measuredCount === 0 && model.unresolvedCount === 0) {
    return `Circuit with ${model.overlays.length} parameterized gates. Run the gradient analysis to tint them.`;
  }
  return `Gradient heatmap: ${model.measuredCount} of ${model.overlays.length} parameterized gates measured, ${model.deadCount} dead, ${
    model.unresolvedCount
  } unresolved (interval only). Variance ranges from ${formatSci(10 ** (model.domain?.[0] ?? 0), 2)} to ${formatSci(10 ** (model.domain?.[1] ?? 0), 2)}.`;
}

function Legend({ model }: { model: HeatmapModel }) {
  const measured = model.measuredCount > 0;
  return (
    <div className="lab-row" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
      {measured && model.domain ? (
        <RampLegend label="Var[∂C/∂θ] (log)" low={formatSci(10 ** model.domain[0], 2)} high={formatSci(10 ** model.domain[1], 2)} />
      ) : model.unresolvedCount === 0 ? (
        <span className="lab-muted">Gates with free parameters are outlined; run gradients to tint them.</span>
      ) : null}
      <span className="lab-row" style={{ gap: 'var(--space-1)' }}>
        <svg width={16} height={12} aria-hidden>
          <rect width={16} height={12} rx={3} style={{ fill: 'var(--lab-surface-3)', stroke: 'var(--color-text-tertiary)' }} />
          <line x1={2} y1={10} x2={10} y2={2} style={{ stroke: 'var(--color-text-tertiary)' }} />
          <line x1={7} y1={11} x2={14} y2={4} style={{ stroke: 'var(--color-text-tertiary)' }} />
        </svg>
        <span className="lab-muted">dead gate (≈ zero variance){measured ? `: ${model.deadCount}` : ''}</span>
      </span>
      {model.unresolvedCount > 0 && (
        <span className="lab-row" style={{ gap: 'var(--space-1)' }}>
          <svg width={16} height={12} aria-hidden>
            <rect width={16} height={12} rx={3} style={{ fill: 'var(--lab-surface-3)', stroke: 'var(--color-text-tertiary)', strokeDasharray: '3 2' }} />
            <path d="M2 2L14 10M14 2L2 10" style={{ stroke: 'var(--color-text-tertiary)', fill: 'none' }} />
          </svg>
          <span className="lab-muted">unresolved (interval only): {model.unresolvedCount}</span>
        </span>
      )}
    </div>
  );
}

/**
 * The parameterized gates, tinted by log-scale Var[∂C/∂θ] (Lab sequential
 * ramp). With a circuit snapshot they are drawn on the circuit; without one
 * (web build + labKernel, where `circuitStore` stays empty) they are drawn as
 * a strip built purely from the Lab's own `trainability_inspected`
 * `param_gates`. The kernel does not report gate qubits or layers, so the
 * strip has no wires. Gates with a null variance are hatched, never tinted.
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
  const hatchDead = useId();
  const hatchUnresolved = useId();
  const [tooltip, setTooltip] = useState<LabTooltipState | null>(null);
  const model = useMemo(
    () => buildHeatmapModel(snapshot?.gates ?? [], inspection, gradients),
    [snapshot, inspection, gradients],
  );

  const showTip = (overlay: GateOverlay, x: number, y: number) =>
    setTooltip({ x, y, content: <TooltipRows title={overlay.parameter} rows={overlayRows(overlay)} /> });
  const hideTip = () => setTooltip(null);

  const placedOnCircuit = !!snapshot && snapshot.gates.length > 0 && model.byGateIndex.size > 0;
  if (!placedOnCircuit && model.overlays.length === 0) {
    if (loading) return <LabSkeleton height={160} />;
    return (
      <LabEmptyState
        icon={Cpu}
        title="No circuit to paint yet"
        body="Open a parameterized circuit so the Lab can inspect it; the gradient heatmap overlays its parameterized gates."
        compact
      />
    );
  }

  const summary = summaryOf(model);

  if (!placedOnCircuit) {
    const rows = Math.ceil(model.overlays.length / STRIP_COLUMNS);
    const step = STRIP_TILE.width + STRIP_TILE.gap;
    const width = Math.min(model.overlays.length, STRIP_COLUMNS) * step + PADDING;
    const height = rows * (STRIP_TILE.height + STRIP_TILE.gap) + PADDING / 2;
    return (
      <div className="lab-stack" style={{ gap: 'var(--space-2)' }}>
        <LabScrollArea label="Parameterized gate heatmap" maxHeight={340}>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Parameterized gates with gradient variance heatmap">
            <Patterns dead={hatchDead} unresolved={hatchUnresolved} />
            {model.overlays.map((overlay, i) => {
              const x = PADDING / 2 + (i % STRIP_COLUMNS) * step;
              const y = PADDING / 4 + Math.floor(i / STRIP_COLUMNS) * (STRIP_TILE.height + STRIP_TILE.gap);
              return (
                <HeatmapGateTile
                  key={overlay.sourceIndex}
                  overlay={overlay}
                  box={{ x, y, width: STRIP_TILE.width, height: STRIP_TILE.height }}
                  labelX={x + STRIP_TILE.width / 2}
                  labelY={y + STRIP_TILE.height / 2}
                  gateName={overlay.gate}
                  hatchDead={hatchDead}
                  hatchUnresolved={hatchUnresolved}
                  onShow={showTip}
                  onHide={hideTip}
                />
              );
            })}
          </svg>
        </LabScrollArea>
        <p className="lab-muted" style={{ margin: 0 }}>
          Parameterized gates in program order. The circuit diagram is not available here, and the kernel&apos;s inspection reports gate names and parameters only, not qubits or layers.
        </p>
        <Legend model={model} />
        <p className="lab-sr-only">{summary}</p>
        <LabTooltip state={tooltip} />
      </div>
    );
  }

  const { qubit_count, depth, gates } = snapshot;
  const svgWidth = LABEL_WIDTH + depth * LAYER_SPACING + PADDING * 2;
  const svgHeight = PADDING * 2 + (qubit_count - 1) * WIRE_SPACING + GLYPH_SIZE / 2;

  return (
    <div className="lab-stack" style={{ gap: 'var(--space-2)' }}>
      <LabScrollArea label="Circuit gradient heatmap" maxHeight={340}>
        <svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} role="img" aria-label="Circuit with gradient variance heatmap">
          <Patterns dead={hatchDead} unresolved={hatchUnresolved} />
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
            return (
              <HeatmapGateTile
                key={`g${index}`}
                overlay={overlay}
                box={b}
                labelX={gateX(gate.layer)}
                labelY={wireY(gate.targets[0] ?? 0)}
                gateName={gate.type}
                hatchDead={hatchDead}
                hatchUnresolved={hatchUnresolved}
                onShow={showTip}
                onHide={hideTip}
              />
            );
          })}
        </svg>
      </LabScrollArea>
      <Legend model={model} />
      <p className="lab-sr-only">{summary}</p>
      <LabTooltip state={tooltip} />
    </div>
  );
}
