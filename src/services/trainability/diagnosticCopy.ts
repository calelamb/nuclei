/**
 * UI copy for kernel lint diagnostics (PH-M3). TRN003 means "polynomial
 * dynamical Lie algebra". A polynomial dimension does NOT bound the 𝔤-purities
 * of the observable and state, so it cannot by itself promise trainability;
 * older kernels still word it "is trainable in the barren-plateau sense", so
 * the UI softens that claim wherever a diagnostic is shown.
 */

import type { TrainabilityDiagnostic } from '../../types/trainability';

const OVERCLAIM = /is trainable in the barren-plateau sense but\s+likely/i;
const SOFT = 'has a polynomial-size algebra, which rules out the exponential-dimension route to a barren plateau, but this alone does not bound the gradient variance, and it is likely';

export function diagnosticMessage(d: Pick<TrainabilityDiagnostic, 'code' | 'message'>): string {
  if (d.code !== 'TRN003') return d.message;
  return d.message.replace(OVERCLAIM, SOFT);
}
