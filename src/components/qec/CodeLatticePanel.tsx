import { Grid3x3 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecStore } from '../../stores/qecStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { stabilizerEdges } from './latticeEdges';
import { latticeLayout, activeQubitsAtTick, tickMomentCount } from './qecGeometry';

import { TYPOGRAPHY } from '../../styles/tokens';
const DOCS = 'https://getnuclei.dev/docs/research/qec-studio/';
/** The lattice is a figure, not a canvas: it stops growing here however wide the card gets. */
const LATTICE_MAX_PX = 400;
/** Node size in screen pixels, independent of the figure's size. */
const NODE_PX = 14;
/** Padding inside the unit square so edge nodes are not cut off by the figure bounds. */
const percent = (v: number): number => 6 + v * 88;

/**
 * PRD 10 Phase D — the code lattice. A 2D plot of data vs measure/ancilla
 * qubits at their circuit coordinates, ancillas tinted by stabilizer basis
 * (X/Z). A tick scrubber highlights which qubits are active at that moment.
 * Hidden gracefully (a designed empty state) when the circuit carries no
 * qubit coordinates.
 */
export function CodeLatticePanel({ embedded = false }: { embedded?: boolean } = {}) {
  const colors = useThemeStore((s) => s.colors);
  const qec = useQecStore((s) => s.snapshot);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const [tick, setTick] = useState(0);

  const layout = useMemo(() => (qec ? latticeLayout(qec, snapshot) : null), [qec, snapshot]);
  const edges = useMemo(() => (layout ? stabilizerEdges(layout.qubits) : []), [layout]);
  const byIndex = useMemo(() => new Map((layout?.qubits ?? []).map((q) => [q.index, q])), [layout]);
  const active = useMemo(
    () => activeQubitsAtTick(snapshot?.gates ?? [], tick),
    [snapshot, tick],
  );

  const header = embedded ? null : <PanelHeader title="Code Lattice" helpHref={DOCS} />;

  if (!qec) return <div style={{ height: '100%', background: colors.bg }}>{header}</div>;

  if (!layout || !layout.hasCoordinates) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
        {header}
        <QecEmptyState
          icon={Grid3x3}
          title="No qubit coordinates"
          body="This circuit doesn't declare qubit coordinates, so there's no lattice to draw. Generated surface/repetition codes include them."
          docsHref={DOCS}
        />
      </div>
    );
  }

  const maxTick = tickMomentCount(qec.num_ticks, snapshot?.gates ?? []) - 1;
  const basisColor = (b: string) => (b === 'X' ? colors.basisX : b === 'Z' ? colors.basisZ : colors.textDim);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      {header}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div
          data-testid="lattice-figure"
          style={{ position: 'relative', width: '100%', maxWidth: LATTICE_MAX_PX, aspectRatio: '1', maxHeight: LATTICE_MAX_PX }}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            {edges.map((e) => {
              const from = byIndex.get(e.from);
              const to = byIndex.get(e.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`${e.from}-${e.to}`}
                  x1={percent(from.x)} y1={percent(from.y)} x2={percent(to.x)} y2={percent(to.y)}
                  stroke={colors.border} strokeWidth={1} vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
          {layout.qubits.map((q) => {
            const isActive = active.has(q.index);
            const isMeasure = q.kind === 'measure';
            const tint = basisColor(q.basis);
            return (
              <span
                key={q.index}
                data-lattice-node={q.kind}
                data-active={isActive ? 'true' : undefined}
                title={`${isMeasure ? 'Measure' : 'Data'} qubit ${q.index}`}
                style={{
                  position: 'absolute', left: `${percent(q.x)}%`, top: `${percent(q.y)}%`,
                  width: NODE_PX, height: NODE_PX, transform: 'translate(-50%, -50%)', boxSizing: 'border-box',
                  borderRadius: isMeasure ? 3 : '50%',
                  background: isMeasure ? `color-mix(in srgb, ${tint} ${isActive ? 75 : 35}%, ${colors.bg})` : colors.bgElevated,
                  border: `1.5px solid ${isActive ? colors.accent : isMeasure ? tint : colors.textDim}`,
                  boxShadow: isActive ? `0 0 0 2px color-mix(in srgb, ${colors.accent} 35%, transparent)` : undefined,
                }}
              />
            );
          })}
        </div>
      </div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          borderTop: `1px solid ${colors.border}`, fontSize: 11, color: colors.textDim,
          fontFamily: TYPOGRAPHY.fontSans,
        }}
      >
        <span>Tick {tick}/{maxTick}</span>
        <input
          type="range" min={0} max={maxTick} value={tick}
          onChange={(e) => setTick(Number(e.target.value))}
          aria-label="Tick scrubber"
          style={{ flex: 1, accentColor: colors.accent, cursor: 'pointer' }}
        />
        <span style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: colors.textDim }}>● data</span>
          <span style={{ color: colors.basisX }}>■ X</span>
          <span style={{ color: colors.basisZ }}>■ Z</span>
          <span style={{ color: colors.accentText }}>◎ active this tick</span>
        </span>
      </div>
    </div>
  );
}
