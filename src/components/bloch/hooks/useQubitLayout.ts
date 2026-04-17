import { useMemo } from 'react';
import { Vector3 } from 'three';

export interface QubitSlot {
  position: Vector3;
  scale: number;
}

/**
 * Deterministic layout for N qubits. Returns both position and scale so
 * the constellation fits the IDE panel without clipping.
 *
 * - 1 qubit: hero, full-scale at origin.
 * - 2 qubits: side-by-side, shrunk to ~half-scale.
 * - 3-6 qubits: ring layout, scale tapers as N grows so neighbors don't
 *   touch.
 * - 7+ qubits: double ring stacked in y, scales further.
 *
 * Sphere unit radius is 1.0; arrow extends to ~1.08. Center-to-center
 * distance must be ≥ 2.2*scale for no overlap. These tables are tuned
 * so there's ~30% breathing room between neighbors.
 */
export function useQubitLayout(count: number): QubitSlot[] {
  return useMemo(() => {
    if (count === 0) return [];
    if (count === 1) {
      return [{ position: new Vector3(0, 0, 0), scale: 1 }];
    }

    if (count === 2) {
      const s = 0.58;
      const dx = 1.0;
      return [
        { position: new Vector3(-dx, 0, 0.15), scale: s },
        { position: new Vector3(dx, 0, -0.15), scale: s },
      ];
    }

    if (count <= 6) {
      // Single ring. Scale + radius tuned so neighbor arcs don't overlap.
      const scale = count <= 4 ? 0.48 : 0.42;
      const arcSpacing = 2.3 * scale; // min center-to-center along the arc
      const radius = Math.max(1.0, (arcSpacing * count) / (2 * Math.PI));
      const slots: QubitSlot[] = [];
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        slots.push({
          position: new Vector3(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius * 0.55,
            0,
          ),
          scale,
        });
      }
      return slots;
    }

    // Two stacked rings for N > 6
    const scale = 0.36;
    const ringSize = Math.ceil(count / 2);
    const arcSpacing = 2.3 * scale;
    const radius = Math.max(1.2, (arcSpacing * ringSize) / (2 * Math.PI));
    const slots: QubitSlot[] = [];
    for (let i = 0; i < count; i++) {
      const inTop = i < ringSize;
      const ringIndex = inTop ? i : i - ringSize;
      const ringCount = inTop ? ringSize : count - ringSize;
      const angle = (ringIndex / ringCount) * Math.PI * 2 - Math.PI / 2;
      slots.push({
        position: new Vector3(
          Math.cos(angle) * radius,
          inTop ? 0.55 : -0.55,
          Math.sin(angle) * radius * 0.32,
        ),
        scale,
      });
    }
    return slots;
  }, [count]);
}
