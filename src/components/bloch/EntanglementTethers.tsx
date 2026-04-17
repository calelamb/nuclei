import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { Vector3 } from 'three';
import type { Gate } from '../../types/quantum';

interface EntanglementTethersProps {
  gates: Gate[];
  positions: Vector3[];
  selectedQubit: number | null;
  reducedMotion: boolean;
}

interface TetherPair { a: number; b: number }

/**
 * Derives which qubit pairs to connect from the circuit's gate history.
 * Any qubit pair that appears together in at least one multi-qubit gate
 * gets a tether. This is a heuristic — the physics-correct upgrade is to
 * compute mutual information from the state vector and scale opacity by
 * I(A:B)/log(2). Phase 1 ships the heuristic; Phase 1.5 layers intensity.
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

export function EntanglementTethers({
  gates,
  positions,
  selectedQubit,
  reducedMotion,
}: EntanglementTethersProps) {
  const tethers = useMemo(() => inferTethers(gates), [gates]);

  if (positions.length < 2 || tethers.length === 0) return null;

  return (
    <group>
      {tethers.map(({ a, b }) => {
        const pa = positions[a];
        const pb = positions[b];
        if (!pa || !pb) return null;

        const involvesSelected = selectedQubit === a || selectedQubit === b;
        const dim = selectedQubit !== null && !involvesSelected;
        const opacity = dim ? 0.15 : involvesSelected ? 0.9 : 0.55;
        const lineWidth = involvesSelected ? 2.2 : 1.2;

        // Curve the tether slightly toward the origin so parallel pairs
        // don't overlap — gives the constellation more depth.
        const mid = new Vector3()
          .addVectors(pa, pb)
          .multiplyScalar(0.5)
          .multiplyScalar(0.7);
        const points: [number, number, number][] = [
          [pa.x, pa.y, pa.z],
          [mid.x, mid.y, mid.z],
          [pb.x, pb.y, pb.z],
        ];

        return (
          <Line
            key={`tether-${a}-${b}`}
            points={points}
            color="#48CAE4"
            lineWidth={lineWidth}
            transparent
            opacity={opacity}
            // @ts-expect-error drei Line accepts these but TS doesn't know
            dashed={false}
            toneMapped={false}
          />
        );
      })}
      {/* Accent glow duplicates the lines with additive blending */}
      {!reducedMotion && tethers.map(({ a, b }) => {
        const pa = positions[a];
        const pb = positions[b];
        if (!pa || !pb) return null;
        const involvesSelected = selectedQubit === a || selectedQubit === b;
        const mid = new Vector3()
          .addVectors(pa, pb)
          .multiplyScalar(0.5)
          .multiplyScalar(0.7);
        return (
          <Line
            key={`tether-glow-${a}-${b}`}
            points={[
              [pa.x, pa.y, pa.z],
              [mid.x, mid.y, mid.z],
              [pb.x, pb.y, pb.z],
            ]}
            color="#00B4D8"
            lineWidth={involvesSelected ? 6 : 3.5}
            transparent
            opacity={involvesSelected ? 0.25 : 0.1}
            toneMapped={false}
          />
        );
      })}
    </group>
  );
}
