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
  recentlyAffected: Set<number>;
  onSelect: (idx: number) => void;
}

/**
 * Arranges floating qubits and draws entanglement tethers. Layout is
 * deterministic — selection never changes positions, only camera focus.
 */
export function Constellation({
  qubits,
  gates,
  selected,
  reducedMotion,
  recentlyAffected,
  onSelect,
}: ConstellationProps) {
  const slots = useQubitLayout(qubits.length);

  return (
    <group>
      <EntanglementTethers
        gates={gates}
        slots={slots}
        selectedQubit={selected}
      />
      {qubits.map((coord, idx) => {
        const slot = slots[idx];
        if (!slot) return null;
        return (
          <group key={idx} scale={slot.scale}>
            <FloatingBlochQubit
              qubit={coord}
              index={idx}
              targetPosition={slot.position.clone().divideScalar(slot.scale)}
              selected={selected === idx}
              dimmed={selected !== null && selected !== idx}
              gateReaction={recentlyAffected.has(idx)}
              reducedMotion={reducedMotion}
              onSelect={() => onSelect(idx)}
            />
          </group>
        );
      })}
    </group>
  );
}
