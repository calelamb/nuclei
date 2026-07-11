import { useCallback, useRef } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { createKernelSession } from '../services/kernelSession';
import { fetchEnvironment } from '../services/kernelEnvironment';
import {
  runExperiment,
  type RunExperimentContext,
  type RunnerDeps,
  type RunnerKernelSession,
} from '../services/experimentRunner';
import {
  createTauriExperimentFs,
  createTauriRunnerFs,
  runnerHash,
  runnerJoin,
  tauriGitInfo,
} from '../services/experimentFs';
import { useExperimentStore, type DiscoveredExperiment } from '../services/experimentStore';
import { useExperimentRunStore } from '../stores/experimentRunStore';
import type { KernelResponse } from '../types/quantum';

/**
 * PRD 09 Phase D (D4) — wires the pure `runExperiment` orchestrator (Phase C)
 * to a real Tauri kernel session and filesystem.
 *
 * Kernel session lifecycle: a sweep gets its OWN dedicated kernel session —
 * separate from the editor's live-parse session — so a running sweep never
 * interleaves its `execute` traffic with the user's ongoing edits. The
 * session is opened right before the sweep starts and closed the moment it
 * ends (success, failure, or cancel). Only one sweep runs at a time app-wide
 * (the runner itself is sequential; enforced via `experimentRunStore`'s
 * single `active` slot), so a single dedicated session per invocation is all
 * that's ever needed.
 */

/** Builds a multi-subscriber `RunnerKernelSession` over one dedicated kernel
 * connection — `runExperiment` and `fetchEnvironment` both subscribe to it. */
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

export function useExperimentRun() {
  const platform = usePlatform();
  // Guards the brief window between "run() called" and "store.active set",
  // so a rapid double-click can't open two dedicated sessions.
  const startingRef = useRef(false);

  const run = useCallback(
    async (experiment: DiscoveredExperiment, projectRoot: string) => {
      if (startingRef.current || useExperimentRunStore.getState().active) return;
      startingRef.current = true;

      let runnerSession: RunnerKernelSession;
      let closeSession: () => void;
      try {
        const opened = await openRunnerSession(platform.getPlatform());
        runnerSession = opened.session;
        closeSession = opened.close;
      } catch (e) {
        startingRef.current = false;
        useExperimentRunStore.getState().finish(
          null,
          e instanceof Error ? e.message : 'Failed to open a kernel session for the sweep',
        );
        return;
      }

      const signal = { aborted: false };
      const experimentFs = createTauriExperimentFs();
      const ctx: RunExperimentContext = {
        projectRoot,
        experimentFileName: experiment.fileName,
      };

      useExperimentRunStore.getState().start({
        experimentFileName: experiment.fileName,
        experimentName: experiment.spec.name,
        cancel: () => {
          signal.aborted = true;
        },
      });
      startingRef.current = false;

      const deps: RunnerDeps = {
        session: runnerSession,
        fs: createTauriRunnerFs(),
        clock: { now: () => new Date() },
        join: runnerJoin,
        hash: runnerHash,
        gitInfo: tauriGitInfo,
        environment: () => fetchEnvironment(runnerSession),
        readEntry: async (path) => {
          const content = await platform.readFile(path);
          if (content === null) {
            throw new Error(`Could not read entry file: ${path}`);
          }
          return content;
        },
        appVersion: __APP_VERSION__,
      };

      try {
        const summary = await runExperiment(experiment.spec, ctx, deps, {
          signal,
          onProgress: (progress) => {
            useExperimentRunStore.getState().updateProgress(progress);
            // Stream rows into the runs table as each point's directory is
            // written, rather than waiting for the whole sweep to finish.
            void useExperimentStore.getState().scanRuns(experiment, projectRoot, experimentFs);
          },
        });
        useExperimentRunStore.getState().finish(summary);
      } catch (e) {
        useExperimentRunStore.getState().finish(null, e instanceof Error ? e.message : String(e));
      } finally {
        closeSession();
      }
    },
    [platform],
  );

  return { run };
}
