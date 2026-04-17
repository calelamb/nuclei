import { useMemo } from 'react';
import { Vector3 } from 'three';

/**
 * Arrange N qubits in 3D space. The layout is deterministic from the qubit
 * count — it never depends on which qubit is selected, so transitions always
 * start and end at predictable positions.
 *
 * - 1 qubit: centered, the whole panel is the hero.
 * - 2 qubits: horizontal pair, slight stagger in z for parallax.
 * - 3-6 qubits: circular ring in the xy-plane, facing the camera.
 * - 7+ qubits: double ring, offset in y, scales radius to keep them in frame.
 */
export function useQubitLayout(count: number): Vector3[] {
  return useMemo(() => {
    if (count === 0) return [];
    if (count === 1) return [new Vector3(0, 0, 0)];
    if (count === 2) {
      return [new Vector3(-1.3, 0, 0.2), new Vector3(1.3, 0, -0.2)];
    }

    const positions: Vector3[] = [];
    if (count <= 6) {
      // Single ring, radius scales gently with count
      const radius = 1.2 + count * 0.12;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        positions.push(
          new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.45, 0),
        );
      }
      return positions;
    }

    // Two stacked rings for N > 6
    const ringSize = Math.ceil(count / 2);
    const radius = 1.6 + ringSize * 0.1;
    for (let i = 0; i < count; i++) {
      const inTop = i < ringSize;
      const ringIndex = inTop ? i : i - ringSize;
      const ringCount = inTop ? ringSize : count - ringSize;
      const angle = (ringIndex / ringCount) * Math.PI * 2 - Math.PI / 2;
      positions.push(
        new Vector3(
          Math.cos(angle) * radius,
          inTop ? 0.55 : -0.55,
          Math.sin(angle) * radius * 0.35,
        ),
      );
    }
    return positions;
  }, [count]);
}
