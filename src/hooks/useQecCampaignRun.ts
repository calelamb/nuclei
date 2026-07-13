import { useCallback, useRef } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { createKernelSession } from '../services/kernelSession';
import { fetchEnvironment } from '../services/kernelEnvironment';
import {
  runQecCampaign,
  type CampaignRunContext,
} from '../services/qecCampaignRunner';
import type { RunnerDeps, RunnerKernelSession } from '../services/experimentRunner';
import {
  createTauriRunnerFs,
  runnerHash,
  runnerJoin,
  tauriGitInfo,
} from '../services/experimentFs';
import { type DiscoveredExperiment } from '../services/experimentStore';
import { useQecCampaignStore } from '../stores/qecCampaignStore';
import { parseSinterCsv } from '../types/qecStats';
import type { KernelResponse } from '../types/quantum';

/**
 * PRD 10 Phase E — runs a QEC campaign experiment end to end, streaming its
 * progress into `qecCampaignStore` (which the threshold/workbench panels + the
 * status-bar chip read). Mirrors `useExperimentRun`'s dedicated-session model:
 * the campaign gets its own kernel connection, opened at start and closed when
 * it ends. One campaign at a time app-wide (the kernel enforces it too).
 */
async function openRunnerSession(
  platformKind: Parameters<typeof createKernelSession>[0],
): Promise<{ session: RunnerKernelSession; close(): void }> {
  const handlers = new Set<(message: KernelResponse) => void>();
  const dispatch = (message: KernelResponse) => {
    for (const handler of [...handlers]) handler(message);
  };
  const kernelSession = await createKernelSession(platformKind, dispatch);
  return {
    session: {
      send: (message) => kernelSession.send(message),
      subscribe(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
    close: () => kernelSession.close(),
  };
}

export function useQecCampaignRun() {
  const platform = usePlatform();
  const startingRef = useRef(false);
  const abortRef = useRef<{ aborted: boolean } | null>(null);

  const run = useCallback(
    async (experiment: DiscoveredExperiment, projectRoot: string) => {
      if (startingRef.current || useQecCampaignStore.getState().running) return;
      if (experiment.spec.type !== 'qec_campaign') return;
      startingRef.current = true;

      let session: RunnerKernelSession;
      let close: () => void;
      try {
        const opened = await openRunnerSession(platform.getPlatform());
        session = opened.session;
        close = opened.close;
      } catch {
        startingRef.current = false;
        return;
      }

      const signal = { aborted: false };
      abortRef.current = signal;
      const experimentYamlText = (await platform.readFile(experiment.path)) ?? '';

      const deps: RunnerDeps = {
        session,
        fs: createTauriRunnerFs(),
        clock: { now: () => new Date() },
        join: runnerJoin,
        hash: runnerHash,
        gitInfo: tauriGitInfo,
        environment: () => fetchEnvironment(session),
        readEntry: async (path) => {
          const content = await platform.readFile(path);
          if (content === null) throw new Error(`Could not read entry file: ${path}`);
          return content;
        },
        appVersion: __APP_VERSION__,
      };
      const ctx: CampaignRunContext = {
        projectRoot,
        experimentFileName: experiment.fileName,
        experimentYamlText,
      };

      useQecCampaignStore.getState().startCampaign(experiment.spec.name, 0);
      startingRef.current = false;

      try {
        const summary = await runQecCampaign(experiment.spec, ctx, deps, {
          signal,
          onProgress: (p) => {
            useQecCampaignStore.getState().mergeRows(p.changedRows, {
              tasksComplete: p.tasksComplete,
              tasksTotal: p.tasksTotal,
              statusMessage: p.statusMessage,
            });
          },
        });
        // Authoritative stats: read the sinter-native stats.csv the runner
        // wrote, so the panels parse the same bytes researchers' scripts do.
        let statsCsv = '';
        if (summary.runDir) {
          const path = runnerJoin(projectRoot, 'experiments', experiment.fileName.replace(/\.experiment\.ya?ml$/i, ''), 'runs', summary.runDir, 'stats.csv');
          statsCsv = (await platform.readFile(path)) ?? '';
        }
        useQecCampaignStore
          .getState()
          .finishCampaign(statsCsv, parseSinterCsv(statsCsv));
      } catch {
        // Leave whatever progress rows accumulated; just stop the running flag.
        const state = useQecCampaignStore.getState();
        state.finishCampaign('', Object.values(state.rowsByStrongId));
      } finally {
        close();
      }
    },
    [platform],
  );

  const cancel = useCallback(() => {
    if (abortRef.current) abortRef.current.aborted = true;
  }, []);

  return { run, cancel };
}
