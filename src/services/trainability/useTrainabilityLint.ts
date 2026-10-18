/**
 * PRD 14 §3.1 — editor diagnostics. In Research mode, for Python buffers that
 * have free circuit parameters, run the fast `trainability_lint` (debounced)
 * and publish Monaco markers under owner `'trainability'`.
 *
 * Gating, in order: Research mode, a Python buffer, a reachable Lab kernel,
 * and an `inspect` that found parameters. Markers are cleared on mode switch,
 * file change, deactivation and unmount.
 */

import { useEffect, useRef } from 'react';
import type * as monaco from 'monaco-editor';
import { useEditorStore } from '../../stores/editorStore';
import { useTrainabilityStore } from '../../stores/trainabilityStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { usePlatform } from '../../platform/PlatformProvider';
import { lintToMarkers, TRAINABILITY_MARKER_OWNER } from './lintMarkers';

export const TRAINABILITY_LINT_DEBOUNCE_MS = 800;

/** The slice of Monaco the hook touches (structural, so tests can fake it). */
export interface LintMonacoApi {
  editor: { setModelMarkers(model: monaco.editor.ITextModel, owner: string, markers: monaco.editor.IMarkerData[]): void };
  MarkerSeverity: { Error: number; Warning: number; Info: number };
}

export interface LintEditorApi {
  getModel(): monaco.editor.ITextModel | null;
}

export interface UseTrainabilityLintOptions {
  monacoApi: LintMonacoApi | null;
  editor: LintEditorApi | null;
  /** Monaco language id of the active buffer. */
  language: string;
  debounceMs?: number;
}

export function useTrainabilityLint({
  monacoApi,
  editor,
  language,
  debounceMs = TRAINABILITY_LINT_DEBOUNCE_MS,
}: UseTrainabilityLintOptions): void {
  const mode = useWorkspaceStore((s) => s.mode);
  const code = useEditorStore((s) => s.code);
  const filePath = useEditorStore((s) => s.filePath);
  const framework = useEditorStore((s) => s.framework);
  const observable = useTrainabilityStore((s) => s.observable);
  const unavailable = useTrainabilityStore((s) => s.unavailable);
  const lint = useTrainabilityStore((s) => s.lint);
  const platformKind = usePlatform().getPlatform();
  useEffect(() => {
    useTrainabilityStore.getState().setPlatform(platformKind);
  }, [platformKind]);

  const active = mode === 'research' && language === 'python' && framework !== 'qsharp' && framework !== 'stim' && !unavailable;
  const ready = monacoApi !== null && editor !== null;

  const clearMarkers = () => {
    const model = editor?.getModel();
    if (monacoApi && model) monacoApi.editor.setModelMarkers(model, TRAINABILITY_MARKER_OWNER, []);
  };
  const clearRef = useRef(clearMarkers);
  clearRef.current = clearMarkers;

  // Debounced inspect → lint pipeline.
  useEffect(() => {
    if (!active || !ready) return undefined;
    const timer = setTimeout(() => {
      void (async () => {
        const store = useTrainabilityStore.getState();
        const target = { code, framework, filePath };
        const inspection = await store.refreshInspection(target);
        if (inspection.status !== 'ready' || !inspection.data || inspection.data.parameters.length === 0) {
          useTrainabilityStore.getState().clearLint();
          return;
        }
        await useTrainabilityStore.getState().refreshLint(target);
      })();
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [active, ready, code, filePath, framework, observable, debounceMs]);

  // Drop stale diagnostics (and markers) whenever the buffer or mode changes.
  useEffect(() => {
    return () => {
      clearRef.current();
      if (useTrainabilityStore.getState().lint.status !== 'idle') useTrainabilityStore.getState().clearLint();
    };
  }, [filePath, active]);

  // Publish markers from the lint state.
  useEffect(() => {
    if (!monacoApi || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    if (!active || lint.status !== 'ready') {
      if (!active) monacoApi.editor.setModelMarkers(model, TRAINABILITY_MARKER_OWNER, []);
      return;
    }
    const markers = lintToMarkers(lint.diagnostics, {
      severity: {
        error: monacoApi.MarkerSeverity.Error,
        warning: monacoApi.MarkerSeverity.Warning,
        info: monacoApi.MarkerSeverity.Info,
      },
      lineCount: model.getLineCount(),
      lineMaxColumn: (line) => model.getLineMaxColumn(line),
    });
    monacoApi.editor.setModelMarkers(model, TRAINABILITY_MARKER_OWNER, markers);
  }, [monacoApi, editor, active, lint]);

  // Unmount: always clear.
  useEffect(() => () => clearRef.current(), []);
}
