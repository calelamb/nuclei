import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { usePlatform } from '../platform/PlatformProvider';
import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useAgentRunStore } from '../stores/agentRunStore';
import type { AgentRunUi } from '../stores/agentRunStore';
import { SONNET_MODEL } from '../config/dirac';
import { hashContent } from '../services/agent/hash';
import type { AgentRunResult, AgentRunState, PatchTransaction } from '../services/agent/types';
import type { Framework } from '../types/quantum';

function generateRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function guardRailFailure(runId: string, summary: string): AgentRunResult {
  return { runId, state: 'failed', success: false, iterations: 0, summary, journal: [] };
}

/** One seed file handed to the Rust runner — mirrors `RunSeedFile` in
 * `src-tauri/src/dirac/runner.rs`. */
interface RunSeedFile {
  path: string;
  framework: Framework;
  content: string;
}

/**
 * The `dirac://run-event` payload shapes emitted by the Rust runner
 * (`src-tauri/src/dirac/runner.rs::RunEvent`), serialized `#[serde(tag =
 * "kind", rename_all = "camelCase")]`. Kept local to this hook since it's
 * the only consumer of the raw wire shape — everything downstream goes
 * through agentRunStore's existing `JournalEntry`/`PatchTransaction` types.
 */
type RunEvent =
  | { kind: 'started'; runId: string; goal: string }
  | { kind: 'state'; runId: string; state: AgentRunState }
  | { kind: 'modelText'; runId: string; text: string }
  | { kind: 'toolCall'; runId: string; toolCallId: string; tool: string; input: Record<string, unknown> }
  | {
      kind: 'toolResult';
      runId: string;
      toolCallId: string;
      tool: string;
      ok: boolean;
      facts: Record<string, unknown>;
      diagnostics: string | null;
    }
  | { kind: 'patch'; runId: string; path: string; beforeContent: string; afterContent: string; transactionId: string }
  | { kind: 'error'; runId: string; message: string }
  | { kind: 'finished'; runId: string; success: boolean; iterations: number; summary: string };

const RUN_EVENT_CHANNEL = 'dirac://run-event';

export interface UseDiracAgentResult {
  start: (goal: string) => Promise<void>;
  cancel: () => void;
  isRunning: boolean;
  activeRun: AgentRunUi | null;
}

/**
 * Wires the desktop Dirac agent (Rust harness, `src-tauri/src/dirac/`) to
 * the frontend: starts a run via the `dirac_start_run` Tauri command,
 * streams its progress off the `dirac://run-event` window event, and
 * projects each event onto agentRunStore for live UI updates — patch
 * events are also applied to the editor buffer when they target the
 * active file. Desktop-only; additive to the existing chat surface
 * (useDirac) — nothing here touches it.
 */
export function useDiracAgent(): UseDiracAgentResult {
  const platform = usePlatform();
  const isWeb = platform.getPlatform() === 'web';

  const activeRun = useAgentRunStore((s) => s.activeRun);
  const isRunning = useAgentRunStore((s) => s.isRunning);

  const runIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const teardown = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    runIdRef.current = null;
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const applyRunEvent = useCallback((event: RunEvent) => {
    const ts = Date.now();
    switch (event.kind) {
      case 'started':
        // beginRun() already ran (with this same runId) before the run was
        // started — nothing further to reconcile.
        break;

      case 'state':
        useAgentRunStore.getState().appendJournal({
          kind: 'state_change',
          ts,
          from: useAgentRunStore.getState().activeRun?.state ?? 'planning',
          to: event.state,
        });
        break;

      case 'modelText':
        useAgentRunStore.getState().appendJournal({ kind: 'model_text', ts, text: event.text });
        break;

      case 'toolCall':
        useAgentRunStore.getState().appendJournal({
          kind: 'tool_call',
          ts,
          toolCallId: event.toolCallId,
          tool: event.tool,
          input: event.input,
        });
        break;

      case 'toolResult':
        useAgentRunStore.getState().appendJournal({
          kind: 'tool_result',
          ts,
          evidence: {
            toolCallId: event.toolCallId,
            tool: event.tool,
            ok: event.ok,
            facts: event.facts,
            diagnostics: event.diagnostics ?? undefined,
          },
        });
        break;

      case 'patch': {
        const tx: PatchTransaction = {
          id: event.transactionId,
          path: event.path,
          beforeContent: event.beforeContent,
          afterContent: event.afterContent,
          // The Rust runner doesn't ship content hashes over the wire —
          // derive them locally with the same FNV-1a helper the TS
          // orchestrator's workspace uses, so the shape stored here is
          // identical to a locally-applied patch.
          beforeHash: hashContent(event.beforeContent),
          afterHash: hashContent(event.afterContent),
          appliedAt: ts,
          rolledBack: false,
        };
        useAgentRunStore.getState().recordPatch(tx);

        const activePath = useProjectStore.getState().activeTabPath ?? 'editor';
        if (event.path === activePath) {
          useEditorStore.getState().setCode(event.afterContent);
        }
        break;
      }

      case 'error':
        useAgentRunStore.getState().appendJournal({ kind: 'error', ts, message: event.message });
        break;

      case 'finished': {
        const journal = useAgentRunStore.getState().activeRun?.journal ?? [];
        const state = useAgentRunStore.getState().activeRun?.state ?? (event.success ? 'completed' : 'failed');
        useAgentRunStore.getState().finishRun({
          runId: event.runId,
          state,
          success: event.success,
          iterations: event.iterations,
          summary: event.summary,
          journal,
        });
        teardown();
        break;
      }
    }
  }, [teardown]);

  const start = useCallback(
    async (goal: string) => {
      if (useAgentRunStore.getState().isRunning) return;

      if (isWeb) {
        const runId = generateRunId();
        useAgentRunStore.getState().beginRun(goal, runId);
        useAgentRunStore.getState().finishRun(guardRailFailure(runId, 'Agent mode requires the desktop app.'));
        return;
      }

      try {
        const hasApiKey = await invoke<boolean>('dirac_has_api_key');
        if (!hasApiKey) {
          const runId = generateRunId();
          useAgentRunStore.getState().beginRun(goal, runId);
          useAgentRunStore.getState().finishRun(
            guardRailFailure(runId, 'Add your Anthropic API key in Settings before running the agent.'),
          );
          return;
        }

        const activePath = useProjectStore.getState().activeTabPath ?? 'editor';
        const files: RunSeedFile[] = [
          {
            path: activePath,
            framework: useEditorStore.getState().framework,
            content: useEditorStore.getState().code,
          },
        ];

        // Register the listener BEFORE invoking dirac_start_run so no event
        // emitted right after the run thread spawns is missed. We don't know
        // the real run id yet (invoke() hasn't resolved), so buffer events
        // until it's known, then flush the ones that match.
        let resolvedRunId: string | null = null;
        const buffered: RunEvent[] = [];

        const unlisten = await listen<RunEvent>(RUN_EVENT_CHANNEL, (e) => {
          if (resolvedRunId === null) {
            buffered.push(e.payload);
            return;
          }
          if (e.payload.runId !== resolvedRunId) return;
          applyRunEvent(e.payload);
        });
        unlistenRef.current = unlisten;

        const runId = await invoke<string>('dirac_start_run', {
          goal,
          files,
          activePath,
          model: SONNET_MODEL,
        });

        runIdRef.current = runId;
        resolvedRunId = runId;
        useAgentRunStore.getState().beginRun(goal, runId);

        for (const bufferedEvent of buffered) {
          if (bufferedEvent.runId === runId) applyRunEvent(bufferedEvent);
        }
      } catch (e) {
        teardown();
        const runId = generateRunId();
        useAgentRunStore.getState().beginRun(goal, runId);
        useAgentRunStore.getState().finishRun(
          guardRailFailure(runId, e instanceof Error ? e.message : 'Agent run failed unexpectedly.'),
        );
      }
    },
    [isWeb, applyRunEvent, teardown],
  );

  const cancel = useCallback(() => {
    const runId = runIdRef.current;
    if (!runId) return;
    void invoke('dirac_cancel_run', { runId }).catch(() => {
      // Best-effort — if this fails the run keeps going until it finishes
      // (or the backend's own budget guard stops it) and the UI reflects
      // whatever state events keep arriving.
    });
  }, []);

  return { start, cancel, isRunning, activeRun };
}
