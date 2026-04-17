import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import type { Gate } from '../../types/quantum';
import type { QubitSlot } from './hooks/useQubitLayout';

interface EntanglementTethersProps {
  gates: Gate[];
  slots: QubitSlot[];
  selectedQubit: number | null;
}

interface TetherPair { a: number; b: number }

/**
 * Draws a thin curved line between qubit pairs that share a multi-qubit
 * gate. Selected pair brightens; unrelated pairs dim slightly.
 *
 * Phase 1: presence-only (any shared gate → tether).
 * Phase 1.5: modulate intensity by mutual information from the state
 * vector so bright = actually-correlated, not just gate-history.
 */
function inferTethers(gates: Gate[]): TetherPair[] {
  const seen = new Set<string>();
  const pairs: TetherPair[] = [];
  for (const gate of gates) {
    const involved = [...gate.controls, ...gate.targets];
    if (involved.length < 2) continue;
    for (let i = 0; i < involved.length; i++) {
      for (let j = i + 1; j < involved.length; j++) {
        const a = Math.min(involved[i], involved[j]);
        const b = Math.max(involved[i], involved[j]);
        const key = `${a}-${b}`;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push({ a, b });
        }
      }
    }
  }
  return pairs;
}

export function EntanglementTethers({ gates, slots, selectedQubit }: EntanglementTethersProps) {
  const tethers = useMemo(() => inferTethers(gates), [gates]);

  if (slots.length < 2 || tethers.length === 0) return null;

  return (
    <group>
      {tethers.map(({ a, b }) => {
        const sa = slots[a];
        const sb = slots[b];
        if (!sa || !sb) return null;

        const involvesSelected = selectedQubit === a || selectedQubit === b;
        const dim = selectedQubit !== null && !involvesSelected;
        const opacity = dim ? 0.18 : involvesSelected ? 0.95 : 0.6;
        const lineWidth = involvesSelected ? 2.2 : 1.3;

        // Curve the tether by pulling the midpoint inward toward origin —
        // gives depth and keeps parallel pairs from stacking flatly.
        const midX = (sa.position.x + sb.position.x) * 0.35;
        const midY = (sa.position.y + sb.position.y) * 0.35;
        const midZ = (sa.position.z + sb.position.z) * 0.35;

        return (
          <Line
            key={`tether-${a}-${b}`}
            points={[
              [sa.position.x, sa.position.y, sa.position.z],
              [midX, midY, midZ],
              [sb.position.x, sb.position.y, sb.position.z],
            ]}
            color="#48CAE4"
            lineWidth={lineWidth}
            transparent
            opacity={opacity}
            toneMapped={false}
          />
        );
      })}
    </group>
  );
}
