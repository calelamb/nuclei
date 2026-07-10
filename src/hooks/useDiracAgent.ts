import { useCallback, useEffect, useRef } from 'react';
import { usePlatform } from '../platform/PlatformProvider';
import { useDiracStore } from '../stores/diracStore';
import { useEditorStore } from '../stores/editorStore';
import { useAgentRunStore } from '../stores/agentRunStore';
import { useHardwareStore } from '../stores/hardwareStore';
import type { AgentRunUi } from '../stores/agentRunStore';
import { KERNEL_WS_URL } from '../config/kernel';
import { SONNET_MODEL } from '../config/dirac';
import { HttpModel } from '../services/agent/liveModel';
import { SessionKernel } from '../services/agent/liveKernel';
import type { KernelTransport } from '../services/agent/liveKernel';
import { storeWorkspace } from '../services/agent/storeWorkspace';
import { StoreJournal } from '../services/agent/storeJournal';
import { runAgent } from '../services/agent/orchestrator';
import type { AgentRunResult, JournalEntry } from '../services/agent/types';

function generateRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function guardRailFailure(runId: string, summary: string): AgentRunResult {
  return { runId, state: 'failed', success: false, iterations: 0, summary, journal: [] };
}

/** Reads `transactionId` out of an apply_patch tool_result's evidence facts,
 * if present, without assuming its shape. */
function transactionIdFromFacts(facts: Record<string, unknown>): string | null {
  const value = facts.transactionId;
  return typeof value === 'string' ? value : null;
}

export interface UseDiracAgentResult {
  start: (goal: string) => Promise<void>;
  cancel: () => void;
  isRunning: boolean;
  activeRun: AgentRunUi | null;
}

/**
 * Wires the Stage 1A agent orchestrator core to live app state: the desktop
 * kernel's isolated-worker `agent_execute` WebSocket protocol, the editor
 * buffer (via the StoreWorkspace singleton), Dirac's stored API key, and
 * agentRunStore for live UI updates. Additive to the existing chat surface
 * (useDirac) — nothing here touches it.
 */
export function useDiracAgent(): UseDiracAgentResult {
  const platform = usePlatform();
  const isWeb = platform.getPlatform() === 'web';

  const activeRun = useAgentRunStore((s) => s.activeRun);
  const isRunning = useAgentRunStore((s) => s.isRunning);

  const socketRef = useRef<WebSocket | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const closeSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => () => closeSocket(), [closeSocket]);

  const start = useCallback(
    async (goal: string) => {
      if (useAgentRunStore.getState().isRunning) return;

      if (isWeb) {
        const runId = generateRunId();
        useAgentRunStore.getState().beginRun(goal, runId);
        useAgentRunStore.getState().finishRun(guardRailFailure(runId, 'Agent mode requires the desktop app.'));
        return;
      }

      const apiKey = useDiracStore.getState().apiKey;
      if (!apiKey || apiKey.trim() === '') {
        const runId = generateRunId();
        useAgentRunStore.getState().beginRun(goal, runId);
        useAgentRunStore.getState().finishRun(
          guardRailFailure(runId, 'Add your Anthropic API key in Settings before running the agent.'),
        );
        return;
      }

      const runId = generateRunId();
      const controller = new AbortController();
      controllerRef.current = controller;

      useAgentRunStore.getState().beginRun(goal, runId);

      const journal = new StoreJournal({
        onEntry: (entry: JournalEntry) => {
          useAgentRunStore.getState().appendJournal(entry);
          if (entry.kind === 'tool_result' && entry.evidence.tool === 'apply_patch' && entry.evidence.ok) {
            const transactionId = transactionIdFromFacts(entry.evidence.facts);
            const tx = transactionId ? storeWorkspace.getTransaction(transactionId) : undefined;
            if (tx) useAgentRunStore.getState().recordPatch(tx);
          }
        },
      });

      const socket = new WebSocket(KERNEL_WS_URL);
      socketRef.current = socket;

      const opened = await new Promise<boolean>((resolve) => {
        socket.onopen = () => resolve(true);
        socket.onerror = () => resolve(false);
      });

      if (!opened) {
        useAgentRunStore.getState().finishRun(
          guardRailFailure(runId, 'Could not connect to the local kernel. Is Nuclei still starting up?'),
        );
        closeSocket();
        controllerRef.current = null;
        return;
      }

      const transport: KernelTransport = {
        send: (message) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
        },
        onMessage: (handler) => {
          const listener = (event: MessageEvent) => {
            try {
              handler(JSON.parse(event.data));
            } catch {
              // Malformed frame — nothing a pending request could match on.
            }
          };
          socket.addEventListener('message', listener);
          return () => socket.removeEventListener('message', listener);
        },
      };

      const kernel = new SessionKernel(transport, () => useEditorStore.getState().framework);
      const model = new HttpModel({ apiKey, model: SONNET_MODEL });

      try {
        const result = await runAgent(goal, {
          model,
          kernel,
          workspace: storeWorkspace,
          journal,
          signal: controller.signal,
          runId,
          getBackends: () => useHardwareStore.getState().backends,
        });
        useAgentRunStore.getState().finishRun(result);
      } catch (e) {
        useAgentRunStore.getState().finishRun({
          runId,
          state: 'failed',
          success: false,
          iterations: 0,
          summary: e instanceof Error ? e.message : 'Agent run failed unexpectedly.',
          journal: journal.entries(),
        });
      } finally {
        closeSocket();
        controllerRef.current = null;
      }
    },
    [isWeb, closeSocket],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return { start, cancel, isRunning, activeRun };
}
