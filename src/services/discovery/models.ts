/**
 * Discovery-local model map. The Discovery Engine defaults to the newest
 * Claude generation independent of the Dirac chat models in `config/dirac.ts`.
 */

import type { ModelTier } from '../../types/discovery';

export const DISCOVERY_HAIKU_MODEL = 'claude-haiku-5-5';
export const DISCOVERY_SONNET_MODEL = 'claude-sonnet-5-5';
export const DISCOVERY_OPUS_MODEL = 'claude-opus-5-5';

export const TIER_MODEL_IDS: Readonly<Record<ModelTier, string>> = {
  haiku: DISCOVERY_HAIKU_MODEL,
  sonnet: DISCOVERY_SONNET_MODEL,
  opus: DISCOVERY_OPUS_MODEL,
};
