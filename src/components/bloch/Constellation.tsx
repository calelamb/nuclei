import { FloatingBlochQubit } from './FloatingBlochQubit';
import { EntanglementTethers } from './EntanglementTethers';
import { useQubitLayout } from './hooks/useQubitLayout';
import type { Gate } from '../../types/quantum';

interface BlochCoord { x: number; y: number; z: number }

interface ConstellationProps {
  qubits: BlochCoord[];
  gates: Gate[];
  selected: number | null;
  reducedMotion: boolean;
  /** Set of qubit indices recently touched by an added gate — triggers one-shot tilt */
  recentlyAffected: Set<number>;
  onSelect: (idx: number) => void;
}

/**
 * Arranges floating qubits in a deterministic layout (ring for small N,
 * double ring for larger N) and draws entanglement tethers between pairs
 * that share a multi-qubit gate. Layout never depends on selection — it's
 * a pure function of qubit count, so transitions are stable.
 */
export function Constellation({
  qubits,
  gates,
  selected,
  reducedMotion,
  recentlyAffected,
  onSelect,
}: ConstellationProps) {
  const positions = useQubitLayout(qubits.length);

  return (
    <group>
      <EntanglementTethers
        gates={gates}
        positions={positions}
        selectedQubit={selected}
        reducedMotion={reducedMotion}
      />
      {qubits.map((coord, idx) => (
        <FloatingBlochQubit
          key={idx}
          qubit={coord}
          index={idx}
          targetPosition={positions[idx]}
          selected={selected === idx}
          dimmed={selected !== null && selected !== idx}
          gateReaction={recentlyAffected.has(idx)}
          reducedMotion={reducedMotion}
          onSelect={() => onSelect(idx)}
        />
      ))}
    </group>
  );
}
