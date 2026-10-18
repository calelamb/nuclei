/** After "Open circuit" succeeds the kernel has this long to send the parsed circuit before we say why not. */
export const CIRCUIT_LOAD_TIMEOUT_MS = 10_000;

export type OpenFeedbackPhase = 'idle' | 'loading' | 'stalled';

/** idle -> (open resolved) loading -> (timeout, still no circuit) stalled. A circuit arriving ends it. */
export function nextOpenPhase(
  phase: OpenFeedbackPhase,
  event: 'opened' | 'timeout' | 'circuit' | 'reset',
): OpenFeedbackPhase {
  if (event === 'circuit' || event === 'reset') return 'idle';
  if (event === 'opened') return 'loading';
  return phase === 'loading' ? 'stalled' : phase;
}
