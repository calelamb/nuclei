import { useThemeStore } from '../../stores/themeStore';
import { renderGate, WIRE_SPACING, LAYER_SPACING, LABEL_WIDTH, PADDING } from '../circuit/gates';
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
      <div style={{ padding: 16, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
        No circuit snapshot recorded for this run.
      </div>
    );
  }

  const { qubit_count, depth, gates, classical_bit_count } = snapshot;
  const svgWidth = LABEL_WIDTH + depth * LAYER_SPACING + PADDING * 2;
  const hasClassical = classical_bit_count > 0;
  const classicalWireY = PADDING + qubit_count * WIRE_SPACING + (hasClassical ? 15 : 0);
  const svgHeight = classicalWireY + (hasClassical ? 20 : 0) + PADDING;

  return (
    <div style={{ overflow: 'auto' }} role="region" aria-label="Run circuit diagram">
      <svg
        width="100%"
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ minWidth: svgWidth }}
      >
        {Array.from({ length: qubit_count }, (_, i) => {
          const y = PADDING + i * WIRE_SPACING;
          return (
            <g key={`wire-${i}`}>
              <line
                x1={LABEL_WIDTH - 10} y1={y}
                x2={svgWidth - PADDING} y2={y}
                stroke={colors.wire} strokeWidth={1.5}
                strokeOpacity={0.7}
              />
              <text
                x={LABEL_WIDTH - 20} y={y}
                textAnchor="end" dominantBaseline="central"
                fill={colors.text} fontSize={13}
                fontFamily="'Fira Code', monospace"
              >
                |{i}⟩
              </text>
            </g>
          );
        })}

        {hasClassical && (
          <g>
            <line x1={LABEL_WIDTH - 10} y1={classicalWireY - 2} x2={svgWidth - PADDING} y2={classicalWireY - 2} stroke={colors.wire} strokeWidth={1} strokeDasharray="4,3" />
            <line x1={LABEL_WIDTH - 10} y1={classicalWireY + 2} x2={svgWidth - PADDING} y2={classicalWireY + 2} stroke={colors.wire} strokeWidth={1} strokeDasharray="4,3" />
            <text x={LABEL_WIDTH - 20} y={classicalWireY} textAnchor="end" dominantBaseline="central" fill={colors.textDim} fontSize={11} fontFamily="'Fira Code', monospace">c</text>
          </g>
        )}

        {gates.map((gate, idx) => {
          const x = LABEL_WIDTH + gate.layer * LAYER_SPACING + LAYER_SPACING / 2;
          return <g key={`gate-${idx}`}>{renderGate(gate, x, noop, noop)}</g>;
        })}
      </svg>
    </div>
  );
}
