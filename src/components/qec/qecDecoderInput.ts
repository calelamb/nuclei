import type { DetectorGraphLayout, DecodeOverlay } from './qecGeometry';
import type { DecodeInput, DecodedResult } from '../../lib/qecDecoderWasm';

/**
 * Pure glue between the detector-graph layout and the interactive WASM decoder.
 * Kept out of the component so the mapping is unit-testable without the wasm.
 */

/** Build the decoder input from the rendered graph. Edge weights are
 * `-ln(p)` (clamped) so likelier error mechanisms are cheaper to traverse —
 * the standard minimum-weight-matching cost. */
export function buildDecodeInput(
  layout: DetectorGraphLayout,
  numDetectors: number,
  numObservables: number,
  syndrome: Set<number>,
): DecodeInput {
  const edges = layout.edges.map((e) => ({
    a: e.a,
    b: e.b,
    weight: -Math.log(Math.min(Math.max(e.p, 1e-12), 1 - 1e-12)),
    obs: e.obs,
  }));
  return {
    num_detectors: numDetectors,
    num_observables: numObservables,
    edges,
    syndrome: [...syndrome].sort((a, b) => a - b),
  };
}

/** Map a decode result into the overlay the detector-graph canvas renders:
 * the fired detectors, the correction edges to light up, and whether the
 * correction crosses a logical observable (a would-be logical error). */
export function decodedToOverlay(syndrome: Set<number>, decoded: DecodedResult): DecodeOverlay {
  return {
    firedDetectors: new Set(syndrome),
    matchedEdges: decoded.correction_edges.map((e) => ({ a: e.a, b: e.b })),
    logicalError: decoded.predicted_flips.some(Boolean),
  };
}
