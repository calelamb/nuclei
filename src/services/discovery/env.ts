/** Production wiring of the Discovery Engine's injected dependencies. */

import type { PlatformBridge } from '../../platform/bridge';
import { sha256Hex } from '../../lib/sha256';
import { useDiracStore } from '../../stores/diracStore';
import { openLabSession } from '../lab/labSession';
import { createLlmMutator, type DiscoveryLlm } from './llmMutator';
import { createPlatformDiscoveryFs, platformJoin } from './platformFs';
import type { DiscoveryFs, JoinFn } from './records';
import type { DiscoveryDeps, RunnerClock } from './runContext';

export type DiscoverySession = DiscoveryDeps['session'] & { close?: () => void };

export interface DiscoveryEnv {
  fs: DiscoveryFs;
  join: JoinFn;
  hash: (text: string) => Promise<string>;
  clock: RunnerClock;
  llm: DiscoveryLlm;
  /** A dedicated kernel session (one per run, so long jobs never queue behind the editor). */
  openSession(): Promise<DiscoverySession>;
}

export function createDiscoveryEnv(platform: PlatformBridge): DiscoveryEnv {
  return {
    fs: createPlatformDiscoveryFs(platform),
    join: platformJoin,
    hash: sha256Hex,
    clock: { now: () => new Date(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    llm: createLlmMutator({ getApiKey: () => useDiracStore.getState().apiKey, hash: sha256Hex }),
    openSession: () => openLabSession(platform.getPlatform(), { getToken: platform.getKernelAuthToken?.bind(platform) }),
  };
}
