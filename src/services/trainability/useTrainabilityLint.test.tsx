// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../stores/editorStore';
import { setTrainabilityClientFactory, useTrainabilityStore } from '../../stores/trainabilityStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { createTrainabilityClient } from './client';
import { createFakeSession, type FakeLabSession } from './fakeSession';
import { FIXTURE_CODE, inspectionFixture, lintDiagnosticsFixture, lintSummaryFixture } from './fixtures';
import { TRAINABILITY_LINT_DEBOUNCE_MS, useTrainabilityLint, type LintEditorApi, type LintMonacoApi } from './useTrainabilityLint';
import { withPlatform } from './testBridge';

let session: FakeLabSession;
let inspection = inspectionFixture;

function fakeMonaco() {
  const setModelMarkers = vi.fn();
  const api: LintMonacoApi = {
    editor: { setModelMarkers },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
  };
  const model = { getLineCount: () => 30, getLineMaxColumn: () => 40 };
  const editor: LintEditorApi = { getModel: () => model as never };
  return { api, editor, setModelMarkers, model };
}

const lastMarkers = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)?.[2] as Array<{ code: string }> | undefined;

function setup(language = 'python') {
  const monaco = fakeMonaco();
  const hook = renderHook(
    (props: { language: string }) => useTrainabilityLint({ monacoApi: monaco.api, editor: monaco.editor, language: props.language }),
    { initialProps: { language }, wrapper: withPlatform('desktop') },
  );
  return { monaco, ...hook };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  inspection = inspectionFixture;
  useTrainabilityStore.getState().reset();
  useEditorStore.setState({ code: FIXTURE_CODE, framework: 'qiskit', filePath: '/p/a.py' });
  useWorkspaceStore.setState({ mode: 'research' });
  session = createFakeSession((message, s) => {
    if (message.type === 'trainability_inspect') s.emit({ type: 'trainability_inspected', ...inspection });
    if (message.type === 'trainability_lint') {
      s.emit({ type: 'trainability_lint_result', diagnostics: lintDiagnosticsFixture, summary: lintSummaryFixture });
    }
  });
  setTrainabilityClientFactory(async () => createTrainabilityClient(session));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setTrainabilityClientFactory(null);
});

describe('useTrainabilityLint', () => {
  it('debounces by 800 ms, then inspects, lints and publishes markers under "trainability"', async () => {
    const { monaco } = setup();
    await advance(TRAINABILITY_LINT_DEBOUNCE_MS - 100);
    expect(session.sent).toHaveLength(0);
    await advance(200);
    expect(session.sent.map((m) => m.type)).toEqual(['trainability_inspect', 'trainability_lint']);
    const call = monaco.setModelMarkers.mock.calls.at(-1)!;
    expect(call[1]).toBe('trainability');
    expect((call[2] as Array<{ code: string }>).map((m) => m.code)).toEqual(['TRN001', 'TRN004']);
  });

  it('restarts the debounce on every edit (one lint for a burst)', async () => {
    setup();
    for (const code of ['a', 'ab', 'abc']) {
      act(() => useEditorStore.setState({ code }));
      await advance(300);
    }
    expect(session.sent).toHaveLength(0);
    await advance(600);
    expect(session.sent.filter((m) => m.type === 'trainability_lint')).toHaveLength(1);
  });

  it('is inert in Learn mode', async () => {
    useWorkspaceStore.setState({ mode: 'learn' });
    setup();
    await advance(2000);
    expect(session.sent).toHaveLength(0);
  });

  it('is inert for non-Python buffers and on the web build', async () => {
    setup('qsharp');
    await advance(2000);
    expect(session.sent).toHaveLength(0);
    cleanup();
    useTrainabilityStore.getState().setPlatform('web');
    const monaco = fakeMonaco();
    renderHook(() => useTrainabilityLint({ monacoApi: monaco.api, editor: monaco.editor, language: 'python' }), { wrapper: withPlatform('web') });
    await advance(2000);
    expect(session.sent).toHaveLength(0);
  });

  it('only lints when inspect found parameters', async () => {
    inspection = { ...inspectionFixture, parameters: [], param_gates: [] };
    setup();
    await advance(1000);
    expect(session.sent.map((m) => m.type)).toEqual(['trainability_inspect']);
    expect(useTrainabilityStore.getState().lint.status).toBe('idle');
  });

  it('clears markers when switching to Learn mode', async () => {
    const { monaco } = setup();
    await advance(1000);
    expect(lastMarkers(monaco.setModelMarkers)).toHaveLength(2);
    act(() => useWorkspaceStore.setState({ mode: 'learn' }));
    await advance(10);
    expect(lastMarkers(monaco.setModelMarkers)).toEqual([]);
  });

  it('clears markers and lint state when the file changes', async () => {
    const { monaco } = setup();
    await advance(1000);
    expect(useTrainabilityStore.getState().lint.status).toBe('ready');
    act(() => useEditorStore.setState({ filePath: '/p/b.py' }));
    expect(lastMarkers(monaco.setModelMarkers)).toEqual([]);
    expect(useTrainabilityStore.getState().lint.status).toBe('idle');
  });

  it('clears markers on unmount', async () => {
    const { monaco, unmount } = setup();
    await advance(1000);
    unmount();
    expect(lastMarkers(monaco.setModelMarkers)).toEqual([]);
  });
});
