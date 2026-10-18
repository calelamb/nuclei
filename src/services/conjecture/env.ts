/** Production wiring of the Conjecture Engine's injected dependencies. */

import type { PlatformBridge } from '../../platform/bridge';
import { sha256Hex } from '../../lib/sha256';
import { useDiracStore } from '../../stores/diracStore';
import { createPlatformDiscoveryFs, platformJoin } from '../discovery/platformFs';
import type { DiscoveryFs, JoinFn } from '../discovery/records';
import { openLabSession, type LabSession } from '../lab/labSession';
import { createConjectureProposer, type ConjectureProposer } from './proposer';

export interface ConjectureEnv {
  fs: DiscoveryFs;
  join: JoinFn;
  hash: (text: string) => Promise<string>;
  now: () => Date;
  proposer: ConjectureProposer;
  /** A dedicated kernel session, so long tests never queue behind other Lab traffic. */
  openSession(): Promise<LabSession>;
}

export function createConjectureEnv(platform: PlatformBridge): ConjectureEnv {
  return {
    fs: createPlatformDiscoveryFs(platform),
    join: platformJoin,
    hash: sha256Hex,
    now: () => new Date(),
    proposer: createConjectureProposer({ getApiKey: () => useDiracStore.getState().apiKey, hash: sha256Hex }),
    openSession: () => openLabSession(platform.getPlatform()),
  };
}
