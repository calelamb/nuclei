import { useState, useMemo, useRef, useEffect } from 'react';
import { Vector3 } from 'three';
import { useSimulationStore } from '../../stores/simulationStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { BlochStage } from './BlochStage';
import { Constellation } from './Constellation';
import { CameraDirector } from './CameraDirector';
import { useQubitLayout } from './hooks/useQubitLayout';
import { useReducedMotion } from './hooks/useReducedMotion';

const OVERVIEW_POS = new Vector3(0, 0.3, 5);
const OVERVIEW_LOOKAT = new Vector3(0, 0, 0);

/**
 * Bloch sphere panel — a floating constellation of qubits, each rendered
 * as a frosted glass sphere with an emissive state arrow. Click a qubit
 * to focus the camera on it; click empty space to return to overview.
 * Entanglement shows two ways: arrow length naturally shrinks as the
 * reduced density matrix mixes (physics-honest), and glowing tethers
 * connect qubit pairs that share a multi-qubit gate.
 */
export function BlochPanel() {
  const result = useSimulationStore((s) => s.result);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const reducedMotion = useReducedMotion();

  const [selected, setSelected] = useState<number | null>(null);
  const [recentlyAffected, setRecentlyAffected] = useState<Set<number>>(new Set());
  const prevGateCountRef = useRef(0);

  // Memoized so the empty-array fallback is a stable reference — the
  // useMemo deps below can't retrigger on every render.
  const blochCoords = useMemo(
    () => result?.bloch_coords ?? [],
    [result],
  );
  const qubitCount = blochCoords.length;
  const gates = snapshot?.gates ?? [];
  const slots = useQubitLayout(qubitCount);

  // Detect which qubits are touched by a newly-added gate — for the
  // gate-reaction tilt. Compare gate count; when it rises, mark the last
  // gate's qubits as "recently affected" for 500 ms.
  useEffect(() => {
    if (!snapshot) {
      prevGateCountRef.current = 0;
      return;
    }
    const prev = prevGateCountRef.current;
    const now = snapshot.gates.length;
    if (now > prev) {
      const last = snapshot.gates[now - 1];
      const affected = new Set<number>([...last.controls, ...last.targets]);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- pulse state in response to external gate list changes
      setRecentlyAffected(affected);
      const t = setTimeout(() => setRecentlyAffected(new Set()), 520);
      prevGateCountRef.current = now;
      return () => clearTimeout(t);
    }
    prevGateCountRef.current = now;
  }, [snapshot]);

  // Clamp selection if qubit count shrinks (e.g. user removed qubits)
  useEffect(() => {
    if (selected !== null && selected >= qubitCount) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- drop stale index when qubit list shrinks
      setSelected(null);
    }
  }, [qubitCount, selected]);

  // Camera target: overview by default, or pulled in toward the selected qubit
  const cameraTarget = useMemo(() => {
    if (selected === null || !slots[selected]) return OVERVIEW_POS;
    const slot = slots[selected];
    const dir = slot.position.clone().normalize();
    return slot.position.clone().add(dir.multiplyScalar(1.8)).add(new Vector3(0, 0.2, 0));
  }, [selected, slots]);

  const cameraLookAt = useMemo(() => {
    if (selected === null || !slots[selected]) return OVERVIEW_LOOKAT;
    return slots[selected].position;
  }, [selected, slots]);

  const stateDescription = useMemo(() => {
    if (qubitCount === 0) return 'No qubit state to display';
    if (selected !== null && blochCoords[selected]) {
      const { x, y, z } = blochCoords[selected];
      return describeState(x, y, z, selected);
    }
    return `${qubitCount}-qubit constellation. Click a qubit to focus.`;
  }, [qubitCount, selected, blochCoords]);

  if (!result || qubitCount === 0) {
    return <EmptyState />;
  }

  return (
    <div
      style={{ height: '100%', position: 'relative' }}
      role="region"
      aria-label="Bloch sphere visualization"
      aria-description={stateDescription}
    >
      <BlochStage>
        <CameraDirector
          target={cameraTarget}
          overview={OVERVIEW_POS}
          lookAt={cameraLookAt}
          reducedMotion={reducedMotion}
        >
          <Constellation
            qubits={blochCoords}
            gates={gates}
            selected={selected}
            reducedMotion={reducedMotion}
            recentlyAffected={recentlyAffected}
            onSelect={(idx) => setSelected((s) => (s === idx ? null : idx))}
          />
        </CameraDirector>
      </BlochStage>

      {/* Click empty space to deselect */}
      {selected !== null && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: -1,
            pointerEvents: 'auto',
          }}
          aria-hidden="true"
        />
      )}

      {/* Tiny top-right control strip */}
      <div style={{
        position: 'absolute', top: 8, right: 8,
        display: 'flex', gap: 4, zIndex: 2,
      }}>
        {selected !== null && (
          <button
            onClick={() => setSelected(null)}
            style={resetButtonStyle}
            title="Return to overview"
          >
            ⟲ Overview
          </button>
        )}
      </div>

      {/* Selected-qubit state readout */}
      {selected !== null && blochCoords[selected] && (
        <StateReadout
          qubitIndex={selected}
          coord={blochCoords[selected]}
        />
      )}
    </div>
  );
}

const resetButtonStyle: React.CSSProperties = {
  padding: '4px 8px',
  background: 'rgba(8, 14, 24, 0.75)',
  color: '#48CAE4',
  border: '1px solid rgba(0, 180, 216, 0.25)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: 'Inter, sans-serif',
  backdropFilter: 'blur(8px)',
};

function StateReadout({ qubitIndex, coord }: { qubitIndex: number; coord: { x: number; y: number; z: number } }) {
  const len = Math.hypot(coord.x, coord.y, coord.z);
  const purity = len * len; // |r|² is a proxy for pure vs mixed readability
  return (
    <div style={{
      position: 'absolute',
      left: 12, bottom: 12,
      padding: '8px 12px',
      background: 'rgba(8, 14, 24, 0.82)',
      border: '1px solid rgba(0, 180, 216, 0.22)',
      borderRadius: 6,
      color: '#E8ECF1',
      fontFamily: "'Fira Code', monospace",
      fontSize: 11,
      lineHeight: 1.55,
      backdropFilter: 'blur(10px)',
      boxShadow: '0 4px 18px rgba(0, 0, 0, 0.4), 0 0 24px rgba(0, 180, 216, 0.12)',
      minWidth: 140,
    }}>
      <div style={{ color: '#00B4D8', fontWeight: 600, marginBottom: 4, fontFamily: 'Inter, sans-serif' }}>
        Qubit q{qubitIndex}
      </div>
      <div>x = {coord.x.toFixed(3)}</div>
      <div>y = {coord.y.toFixed(3)}</div>
      <div>z = {coord.z.toFixed(3)}</div>
      <div style={{ marginTop: 4, color: '#94A3B8' }}>
        |r| = {len.toFixed(3)} {purity < 0.95 ? '(entangled)' : ''}
      </div>
    </div>
  );
}

function describeState(x: number, y: number, z: number, idx: number): string {
  if (z > 0.9) return `Qubit ${idx}: near |0⟩ state (pointing up)`;
  if (z < -0.9) return `Qubit ${idx}: near |1⟩ state (pointing down)`;
  if (x > 0.9) return `Qubit ${idx}: near |+⟩ state (superposition, pointing +X)`;
  if (x < -0.9) return `Qubit ${idx}: near |-⟩ state (superposition, pointing -X)`;
  if (y > 0.9) return `Qubit ${idx}: near |+i⟩ state (pointing +Y)`;
  if (y < -0.9) return `Qubit ${idx}: near |-i⟩ state (pointing -Y)`;
  const len = Math.hypot(x, y, z);
  if (len < 0.3) return `Qubit ${idx}: highly entangled (near maximally mixed state)`;
  return `Qubit ${idx}: superposition (x=${x.toFixed(2)}, y=${y.toFixed(2)}, z=${z.toFixed(2)})`;
}

function EmptyState() {
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 10,
      color: '#475569',
    }}>
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
