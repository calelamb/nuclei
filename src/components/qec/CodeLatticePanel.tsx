import { useMemo, useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecStore } from '../../stores/qecStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { latticeLayout, activeQubitsAtTick } from './qecGeometry';

const DOCS = 'https://getnuclei.dev/docs/research/qec-studio/';

/**
 * PRD 10 Phase D — the code lattice. A 2D plot of data vs measure/ancilla
 * qubits at their circuit coordinates, ancillas tinted by stabilizer basis
 * (X/Z). A tick scrubber highlights which qubits are active at that moment.
 * Hidden gracefully (a designed empty state) when the circuit carries no
 * qubit coordinates.
 */
export function CodeLatticePanel() {
  const colors = useThemeStore((s) => s.colors);
  const qec = useQecStore((s) => s.snapshot);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const [tick, setTick] = useState(0);

  const layout = useMemo(() => (qec ? latticeLayout(qec, snapshot) : null), [qec, snapshot]);
  const active = useMemo(
    () => activeQubitsAtTick(snapshot?.gates ?? [], tick),
    [snapshot, tick],
  );

  const header = <PanelHeader title="Code Lattice" helpHref={DOCS} />;

  if (!qec) return <div style={{ height: '100%', background: colors.bg }}>{header}</div>;

  if (!layout || !layout.hasCoordinates) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
        {header}
        <QecEmptyState
          title="No qubit coordinates"
          body="This circuit doesn't declare qubit coordinates, so there's no lattice to draw. Generated surface/repetition codes include them."
        />
      </div>
    );
  }

  const maxTick = Math.max(0, (qec.num_ticks || 1) - 1);
  const basisColor = (b: string) => (b === 'X' ? colors.accent : b === 'Z' ? colors.dirac : colors.textDim);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      {header}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
          {layout.qubits.map((q) => {
            const isActive = active.has(q.index);
            const cx = 6 + q.x * 88;
            const cy = 6 + q.y * 88;
            if (q.kind === 'measure') {
              return (
                <rect
                  key={q.index}
                  x={cx - 2.4} y={cy - 2.4} width={4.8} height={4.8} rx={0.8}
                  fill={`${basisColor(q.basis)}${isActive ? 'cc' : '55'}`}
                  stroke={isActive ? colors.text : basisColor(q.basis)} strokeWidth={isActive ? 0.7 : 0.4}
                />
              );
            }
            return (
              <circle
                key={q.index}
                cx={cx} cy={cy} r={2.2}
                fill={isActive ? colors.text : colors.bgElevated}
                stroke={colors.textDim} strokeWidth={0.5}
              />
            );
          })}
        </svg>
      </div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          borderTop: `1px solid ${colors.border}`, fontSize: 10, color: colors.textDim,
          fontFamily: "'Geist Sans', sans-serif",
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
          <span style={{ color: colors.accent }}>■ X</span>
          <span style={{ color: colors.dirac }}>■ Z</span>
        </span>
      </div>
    </div>
  );
}
