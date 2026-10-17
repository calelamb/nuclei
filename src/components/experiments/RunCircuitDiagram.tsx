import { useThemeStore } from '../../stores/themeStore';
import { renderGate, gateY, WIRE_SPACING, LAYER_SPACING, LABEL_WIDTH, PADDING } from '../circuit/gates';
import { TYPOGRAPHY } from '../../styles/tokens';
import type { CircuitSnapshot } from '../../types/quantum';

/**
 * PRD 09 Phase D (D3) — static circuit diagram for a historical run's
 * `snapshot.json`.
 *
 * `CircuitRenderer` (the live editor's circuit panel) reads its snapshot
 * exclusively from the global `circuitStore` and layers on export menus,
 * gate-explorer popups, and step-through mode that all mutate that same
 * store — none of which applies to (or should touch) a read-only historical
 * run. This reuses the actual drawing primitives `CircuitRenderer` is built
 * from (`renderGate` + the layout constants from `circuit/gates.tsx`)
 * without pulling in its live-store coupling or interactive chrome.
 */
export function RunCircuitDiagram({ snapshot }: { snapshot: CircuitSnapshot | null }) {
  const colors = useThemeStore((s) => s.colors);
  const noop = () => {};

  if (!snapshot || snapshot.gates.length === 0) {
    return (
      <div style={{ padding: 16, color: colors.textDim, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
        No circuit snapshot recorded for this run.
      </div>
    );
  }

  const { qubit_count, depth, gates, classical_bit_count } = snapshot;
  const hasClassical = classical_bit_count > 0;
  const layerCount = Math.max(depth, ...gates.map((g) => g.layer + 1));
  const svgWidth = LABEL_WIDTH + layerCount * LAYER_SPACING + PADDING;
  const lastQubitY = PADDING + (qubit_count - 1) * WIRE_SPACING;
  const classicalWireY = lastQubitY + WIRE_SPACING * 0.9;
  const svgHeight = (hasClassical ? classicalWireY : lastQubitY) + PADDING + 8;
  const wireStart = LABEL_WIDTH - 8;
  const wireEnd = svgWidth - PADDING / 2;

  return (
    <div style={{ overflow: 'auto' }} role="region" aria-label="Run circuit diagram">
      <svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ display: 'block', minWidth: svgWidth }}>
        {Array.from({ length: qubit_count }, (_, i) => (
          <g key={`wire-${i}`}>
            <line x1={wireStart} y1={gateY(i)} x2={wireEnd} y2={gateY(i)} stroke={colors.wire} strokeWidth={1.25} />
            <text x={LABEL_WIDTH - 18} y={gateY(i)} textAnchor="end" dominantBaseline="central" fill={colors.textMuted} fontSize={12} fontFamily={TYPOGRAPHY.fontMono}>
              q{i}
            </text>
          </g>
        ))}

        {hasClassical && (
          <g>
            <line x1={wireStart} y1={classicalWireY - 1.5} x2={wireEnd} y2={classicalWireY - 1.5} stroke={colors.wire} strokeWidth={1} />
            <line x1={wireStart} y1={classicalWireY + 1.5} x2={wireEnd} y2={classicalWireY + 1.5} stroke={colors.wire} strokeWidth={1} />
            <text x={LABEL_WIDTH - 18} y={classicalWireY} textAnchor="end" dominantBaseline="central" fill={colors.textDim} fontSize={12} fontFamily={TYPOGRAPHY.fontMono}>c</text>
          </g>
        )}

        {gates.map((gate, idx) => {
          const x = LABEL_WIDTH + gate.layer * LAYER_SPACING + LAYER_SPACING / 2;
          return <g key={`gate-${idx}`}>{renderGate(gate, x, noop, noop, hasClassical ? classicalWireY : undefined)}</g>;
        })}
      </svg>
    </div>
  );
}
