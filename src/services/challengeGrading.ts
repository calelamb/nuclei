import type { QuantumChallenge } from '../types/challenge';

/**
 * A challenge is "state-verified" when every graded case is checked by
 * `state_fidelity` — i.e. against the actual prepared quantum state (Phase 1)
 * or, for query-model problems, an injected oracle (Phase 3). These can't be
 * passed by hardcoding a classical answer, so their ★ is trustworthy.
 *
 * Challenges still graded on measurement marginals or approximation ratio
 * (e.g. QAOA MaxCut) are not state-verified — a hardcoded classical answer can
 * satisfy them — so the UI marks the difference honestly rather than implying
 * every ★ carries the same weight.
 */
export function isStateVerified(challenge: QuantumChallenge): boolean {
  return (
    challenge.testCases.length > 0 &&
    challenge.testCases.every((testCase) => testCase.validation.type === 'state_fidelity')
  );
}

/** True when the challenge hides its secret behind an injected oracle. */
export function isOracleChallenge(challenge: QuantumChallenge): boolean {
  return challenge.oracle !== undefined;
}
