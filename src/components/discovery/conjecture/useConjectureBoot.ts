import { useEffect } from 'react';
import { usePlatform } from '../../../platform/PlatformProvider';
import type { PlatformBridge } from '../../../platform/bridge';
import { createConjectureEnv } from '../../../services/conjecture/env';
import { labAvailability } from '../../../services/lab/labSession';
import { useConjectureStore } from '../../../stores/conjectureStore';

let configuredFor: PlatformBridge | null = null;

/** Test hook: forget what was configured so the next mount boots again. */
export function __resetConjectureBoot(): void {
  configuredFor = null;
}

/**
 * Idempotent: configure the store for this platform once and load the run's
 * ledger from disk. Jobs live in the store, so unmounting never stops a test.
 * Returns whether the Lab can run here (the web build has no kernel).
 */
export function useConjectureBoot(runId: string): { available: boolean } {
  const platform = usePlatform();
  const available = labAvailability(platform.getPlatform()).available;

  useEffect(() => {
    if (!available) return;
    if (configuredFor !== platform) {
      configuredFor = platform;
      useConjectureStore.getState().configure(createConjectureEnv(platform));
    }
    void useConjectureStore.getState().reloadLedger(runId);
  }, [available, platform, runId]);

  return { available };
}
