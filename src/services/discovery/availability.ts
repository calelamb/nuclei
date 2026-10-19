/**
 * Evaluator availability (kernel `discovery_evaluators` -> `available` / `missing` / `install`).
 *
 * The managed venv ships numpy and the quantum frameworks but not Stim or PyMatching, which are
 * Research catalog installs. The kernel lists such an evaluator as `available: false` rather than
 * failing; the UI explains what is needed and fails a run start fast instead of showing a raw error.
 */

import type { DiscoveryEvaluatorInfo, DiscoveryEvaluatorKind } from '../../types/discovery';

/** Human name of the package set an evaluator needs, for the "Needs the ..." sentence. */
const PACK_LABEL: Partial<Record<DiscoveryEvaluatorKind, string>> = {
  qec_memory: 'QEC research pack',
};

/** Older kernels (and kernels with everything installed) send no `available`; treat that as available. */
export function isEvaluatorAvailable(info: DiscoveryEvaluatorInfo | undefined | null): boolean {
  return info?.available !== false;
}

export function findEvaluator(
  evaluators: readonly DiscoveryEvaluatorInfo[],
  kind: DiscoveryEvaluatorKind | string,
): DiscoveryEvaluatorInfo | undefined {
  return evaluators.find((e) => e.kind === kind);
}

/** "Needs the QEC research pack (stim, pymatching)". */
export function unavailableSummary(info: DiscoveryEvaluatorInfo): string {
  const pack = PACK_LABEL[info.kind];
  const missing = info.missing && info.missing.length > 0 ? ` (${info.missing.join(', ')})` : '';
  return pack ? `Needs the ${pack}${missing}` : `Needs optional packages${missing}`;
}

/** Instructions that work without the in-app installer. */
export function unavailableInstructions(info: DiscoveryEvaluatorInfo): string {
  if (info.install?.hint) return info.install.hint;
  const ids = info.install?.catalog_ids ?? info.missing ?? [];
  return ids.length > 0
    ? `Install ${ids.join(', ')} from the Research catalog in Environment setup, then try again.`
    : 'Install the missing packages from the Research catalog in Environment setup, then try again.';
}

/** The full sentence shown when a run cannot start. */
export function unavailableStartMessage(info: DiscoveryEvaluatorInfo): string {
  return `${unavailableSummary(info)}. ${unavailableInstructions(info)}`;
}
