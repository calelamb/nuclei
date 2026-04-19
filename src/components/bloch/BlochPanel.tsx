import { useMemo } from 'react';
import { useSimulationStore } from '../../stores/simulationStore';
import { ClassicBlochSphere } from './ClassicBlochSphere';

/**
 * Bloch sphere panel — a classic interactive sphere (one per qubit),
 * rotatable and zoomable, that updates from the Python kernel's
 * `bloch_coords` after a simulation run.
 *
 * The visual style is a faithful port of the bits-and-electrons
 * simulator (https://github.com/bits-and-electrons/bloch-sphere-simulator),
 * rewritten in React Three Fiber so it slots into Nuclei's panel layout.
 */
export function BlochPanel() {
  const result = useSimulationStore((s) => s.result);

  const blochCoords = useMemo(
    () => result?.bloch_coords ?? [],
    [result],
  );
  const qubitCount = blochCoords.length;

  if (!result || qubitCount === 0) {
    return <EmptyState />;
  }

  // Lay qubits out in a single row — at typical student scale (1–4
  // qubits) this fits the rail, and each sphere gets its own
  // OrbitControls so a user can inspect them independently.
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        gap: 6,
        padding: '10px 10px 12px',
        position: 'relative',
      }}
      role="region"
      aria-label="Bloch sphere visualization"
    >
      {blochCoords.map((coord, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            borderRadius: 10,
            background:
              'radial-gradient(circle at 50% 45%, rgba(20,28,44,0.85) 0%, rgba(8,12,22,0.82) 65%, rgba(5,8,16,0.9) 100%)',
            border: '1px solid rgba(64, 86, 120, 0.28)',
            overflow: 'hidden',
          }}
        >
          <ClassicBlochSphere
            coord={coord}
            qubitLabel={qubitCount > 1 ? `q${i}` : undefined}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 10,
        color: '#475569',
      }}
    >
      <svg width={72} height={72} viewBox="0 0 72 72" style={{ opacity: 0.15 }}>
        <defs>
          <radialGradient id="empty-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00B4D8" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#00B4D8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={36} cy={36} r={32} fill="url(#empty-glow)" />
        <circle cx={36} cy={36} r={30} fill="none" stroke="#3D5A80" strokeWidth={1} />
        <ellipse cx={36} cy={36} rx={30} ry={10} fill="none" stroke="#3D5A80" strokeWidth={0.5} />
        <ellipse cx={36} cy={36} rx={10} ry={30} fill="none" stroke="#3D5A80" strokeWidth={0.5} />
        <line x1={36} y1={4} x2={36} y2={68} stroke="#3D5A80" strokeWidth={0.5} strokeDasharray="2,2" />
        <line x1={4} y1={36} x2={68} y2={36} stroke="#3D5A80" strokeWidth={0.5} strokeDasharray="2,2" />
      </svg>
      <span style={{ fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
        Run a simulation to visualize qubit states
      </span>
    </div>
  );
}
