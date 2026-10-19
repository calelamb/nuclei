/**
 * Pure mapping from kernel gradient output to circuit-gate overlays. The
 * overlay is keyed by `source_index`; the heatmap never mutates circuitStore.
 */

import type { Gate } from '../../types/quantum';
import type { GradientStatistics, TrainabilityInspection } from '../../types/trainability';
import { isNumber, validInterval } from '../../services/trainability/intervals';

/** Variance below this is "dead" (addendum §C: dead means variance < 1e-8). */
export const DEAD_VARIANCE = 1e-8;

export interface GateOverlay {
  /** Index into `snapshot.gates`; null when no circuit snapshot is available. */
  gateIndex: number | null;
  sourceIndex: number;
  parameter: string;
  /** Gate name from the Lab's own inspection (`param_gates[].gate`). */
  gate: string;
  variance: number | null;
  absMean: number | null;
  /** Rigorous or bootstrap bounds for this gate, when the kernel gave them. */
  interval: [number, number] | null;
  /** 0..1 position on the log ramp; null when there is no measurement yet. */
  t: number | null;
  dead: boolean;
  /**
   * The estimator returned only an interval for this gate (null variance).
   * It is never tinted: painting a ramp colour from null would invent a value.
   */
  unresolved: boolean;
}

export interface HeatmapModel {
  overlays: GateOverlay[];
  /** Overlays that could be placed on the circuit snapshot, by snapshot gate index. */
  byGateIndex: ReadonlyMap<number, GateOverlay>;
  /** Log10 bounds of the measured, non-dead variances; null if none. */
  domain: [number, number] | null;
  deadCount: number;
  unresolvedCount: number;
  measuredCount: number;
}

function hasSymbols(gate: Gate): boolean {
  return !!gate.symbols && gate.symbols.some((s) => s !== null);
}

function typeMatches(gate: Gate, name: string): boolean {
  return gate.type.toLowerCase() === name.toLowerCase();
}

/**
 * Resolve a kernel `source_index` to an index in the circuit snapshot. The
 * kernel counts gates in the converted IR, which usually matches the snapshot
 * order; when the gate there is not the expected parameterized gate we fall
 * back to the k-th symbolic gate in the snapshot.
 */
export function resolveGateIndex(
  gates: readonly Gate[],
  paramGate: { source_index: number; gate: string },
  ordinal: number,
  symbolicIndices: readonly number[],
): number | null {
  const direct = gates[paramGate.source_index];
  if (direct && typeMatches(direct, paramGate.gate)) return paramGate.source_index;
  return symbolicIndices[ordinal] ?? null;
}

export function buildHeatmapModel(
  gates: readonly Gate[],
  inspection: TrainabilityInspection | null,
  gradients: GradientStatistics | undefined,
): HeatmapModel {
  const paramGates = inspection?.param_gates ?? [];
  const symbolicIndices = gates.flatMap((g, i) => (hasSymbols(g) ? [i] : []));
  const values = new Map((gradients?.gate_values ?? []).map((v) => [v.source_index, v]));
  const byName = new Map((gradients?.per_parameter ?? []).map((p) => [p.name, p]));

  // Every parameterized gate from the Lab's own inspection becomes an overlay;
  // placing it on a circuit snapshot is optional (it may be absent under web).
  const raw = paramGates.map((pg, ordinal) => ({
    pg,
    gateIndex: gates.length > 0 ? resolveGateIndex(gates, pg, ordinal, symbolicIndices) : null,
    measured: values.get(pg.source_index),
  }));

  const logs = raw
    .map((r) => r.measured?.variance)
    .filter((v): v is number => isNumber(v) && v > DEAD_VARIANCE)
    .map((v) => Math.log10(v));
  const domain: [number, number] | null = logs.length > 0 ? [Math.min(...logs), Math.max(...logs)] : null;

  const overlays: GateOverlay[] = raw.map(({ gateIndex, pg, measured }) => {
    const variance = isNumber(measured?.variance) ? measured.variance : null;
    const dead = variance !== null && variance <= DEAD_VARIANCE;
    const unresolved = measured !== undefined && variance === null;
    let t: number | null = null;
    if (variance !== null && !dead && domain) {
      const span = domain[1] - domain[0];
      t = span > 1e-9 ? (Math.log10(variance) - domain[0]) / span : 0.5;
    }
    return {
      gateIndex,
      sourceIndex: pg.source_index,
      parameter: pg.parameter,
      gate: pg.gate,
      variance,
      absMean: isNumber(measured?.abs_mean) ? measured.abs_mean : null,
      interval: validInterval(measured?.variance_ci95) ?? validInterval(byName.get(pg.parameter)?.variance_ci95),
      t,
      dead,
      unresolved,
    };
  });

  return {
    overlays,
    byGateIndex: new Map(overlays.flatMap((o): Array<[number, GateOverlay]> => (o.gateIndex === null ? [] : [[o.gateIndex, o]]))),
    domain,
    deadCount: overlays.filter((o) => o.dead).length,
    unresolvedCount: overlays.filter((o) => o.unresolved).length,
    measuredCount: overlays.filter((o) => o.variance !== null).length,
  };
}
