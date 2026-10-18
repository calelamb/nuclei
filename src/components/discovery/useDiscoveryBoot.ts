import { useEffect } from 'react';
import { usePlatform } from '../../platform/PlatformProvider';
import type { PlatformBridge } from '../../platform/bridge';
import { labAvailability } from '../../services/lab/labSession';
import { createDiscoveryEnv } from '../../services/discovery/env';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { useProjectStore } from '../../stores/projectStore';

export interface DiscoveryBoot {
  /** Set when the Lab cannot run here (the web build without the DEV kernel override). */
  unavailable: { message: string } | null;
  projectRoot: string | null;
}

let configuredFor: PlatformBridge | null = null;
let evaluatorsRequested = false;

/** Test hook: forget what was configured so the next mount boots again. */
export function __resetDiscoveryBoot(): void {
  configuredFor = null;
  evaluatorsRequested = false;
}

/**
 * Idempotent boot shared by the sidebar and the workbench: configure the
 * store for this platform once, reload definitions when the project changes,
 * and load the evaluator catalog once. Runs live in the store, not in a
 * component, so unmounting never stops a search.
 */
export function useDiscoveryBoot(): DiscoveryBoot {
  const platform = usePlatform();
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const availability = labAvailability(platform.getPlatform());
  const available = availability.available;

  useEffect(() => {
    if (!available || configuredFor === platform) return;
    configuredFor = platform;
    useDiscoveryStore.getState().configure(createDiscoveryEnv(platform));
  }, [available, platform]);

  useEffect(() => {
    if (!available || !projectRoot) return;
    if (configuredFor !== platform) {
      configuredFor = platform;
      useDiscoveryStore.getState().configure(createDiscoveryEnv(platform));
    }
    const state = useDiscoveryStore.getState();
    if (state.projectRoot !== projectRoot) void state.reload(projectRoot);
    if (!evaluatorsRequested && state.evaluators.length === 0) {
      evaluatorsRequested = true;
      void state.loadEvaluators();
    }
  }, [available, platform, projectRoot]);

  return {
    unavailable: available ? null : { message: 'The Discovery Engine needs the desktop Python kernel.' },
    projectRoot,
  };
}
