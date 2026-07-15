import type { BackendInfo } from '../../types/hardware';
import type { TranspilePass } from '../../types/quantum';
import { SIMULATOR_TARGET_ID } from '../../stores/transpileStore';
import type { TranspileTarget } from '../../lib/transpileSender';

/**
 * Pure helpers for the Transpiler Explorer — delta math, pass classification,
 * and target resolution. Kept free of React/store imports so they unit-test
 * without a DOM.
 */

// Unicode minus (−, U+2212) reads better than hyphen-minus for signed numbers.
const MINUS = '−';

/** Format a signed integer for display: "+13", "−2", or "0". */
export function formatSigned(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${MINUS}${Math.abs(n)}`;
  return '0';
}

export type DeltaTone = 'increase' | 'decrease' | 'flat';

/** Direction of a before→after change. Growth from transpilation is expected
 * and informational (the panel colours it with the accent, not error red). */
export function deltaTone(before: number, after: number): DeltaTone {
  if (after > before) return 'increase';
  if (after < before) return 'decrease';
  return 'flat';
}

/** Two-qubit gate names that, when added by a pass, signal routing/entangling
 * cost — the "why did my circuit blow up" passes the panel emphasises. */
export const TWO_QUBIT_GATE_NAMES: ReadonlySet<string> = new Set([
  'swap', 'cx', 'cnot', 'cz', 'ecr', 'iswap', 'dcx', 'ch', 'cy', 'csx',
  'rzz', 'rxx', 'ryy', 'rzx', 'cp', 'crz', 'crx', 'cry', 'cphase', 'cu',
]);

/** Sum of a pass's signed gate-count deltas (net gates added, can be negative
 * for a pass that rewrites many gates into fewer). */
export function totalAddedGates(pass: TranspilePass): number {
  return Object.values(pass.added_gates).reduce((a, b) => a + b, 0);
}

/** True when the pass added at least one two-qubit/entangling gate — these are
 * visually emphasised as the routing cost. */
export function isEntanglingPass(pass: TranspilePass): boolean {
  return Object.entries(pass.added_gates).some(
    ([name, delta]) => delta > 0 && TWO_QUBIT_GATE_NAMES.has(name.toLowerCase()),
  );
}

/** Human summary of what a pass did to the gate makeup, largest-magnitude
 * change first: e.g. "+6 swap", "+32 rz, +16 sx, −16 h". Empty string when the
 * pass reported no gate change (should not happen — such passes are filtered). */
export function formatAddedGates(pass: TranspilePass): string {
  return Object.entries(pass.added_gates)
    .filter(([, delta]) => delta !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([name, delta]) => `${formatSigned(delta)} ${name}`)
    .join(', ');
}

/**
 * Resolve the wire-level transpile target from a selected target id.
 *
 * `'simulator'` (or an id that matches no backend) → all-to-all, no basis
 * constraint (basisGates/couplingMap null). A hardware backend → its gate set
 * and connectivity, so the explorer shows the real routing the device forces.
 */
export function resolveTargetRequest(
  targetId: string,
  backends: readonly BackendInfo[],
  optimizationLevel: 0 | 1 | 2 | 3,
): TranspileTarget {
  if (targetId === SIMULATOR_TARGET_ID) {
    return { basisGates: null, couplingMap: null, optimizationLevel };
  }
  const backend = backends.find((b) => b.name === targetId);
  if (!backend) {
    return { basisGates: null, couplingMap: null, optimizationLevel };
  }
  return {
    basisGates: backend.gateSet.length > 0 ? backend.gateSet : null,
    couplingMap: backend.connectivity.length > 0 ? backend.connectivity : null,
    optimizationLevel,
  };
}
