// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { PlatformProvider } from '../platform/PlatformProvider';
import type { PlatformBridge } from '../platform/bridge';
import { useEditorStore } from '../stores/editorStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { retryKernel } from '../lib/kernelControl';
import { useKernel } from './useKernel';
import type { WorkerRequest, WorkerResponse } from '../platform/pyodide/workerProtocol';

const controls = vi.hoisted(() => ({
  failBoot: false,
  releaseBoot: null as null | (() => void),
  holdBoot: false,
  executeCalls: 0,
  parseReply: { snapshot: null, output: '', error: null } as Record<string, unknown>,
}));

vi.mock('../platform/pyodide/pyodideClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/pyodide/pyodideClient')>();
  class Fake {
    onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
    onerror: ((e: { message?: string }) => void) | null = null;
    terminate() { /* nothing to stop */ }
    postMessage(req: WorkerRequest) {
      const reply = (r: WorkerResponse) => this.onmessage?.({ data: r });
      if (req.type === 'init') {
        reply({ type: 'progress', progress: { step: 1, total: 3, label: 'Downloading Python', fraction: 0 } });
        const finish = () => {
          if (controls.failBoot) reply({ id: req.id, type: 'failure', code: 'load_failed', message: 'x' });
          else reply({ id: req.id, type: 'result', value: 'ready' });
        };
        if (controls.holdBoot) controls.releaseBoot = finish;
        else finish();
        return;
      }
      if (req.fn === 'nuclei_execute') controls.executeCalls += 1;
      const body = req.fn === 'nuclei_parse'
        ? controls.parseReply
        : { result: { shot_count: 1 }, snapshot: null, output: '', error: null };
      reply({ id: req.id, type: 'result', value: JSON.stringify(body) });
    }
  }
  return { ...actual, pyodideRuntime: new actual.PyodideRuntimeClient(() => new Fake() as never) };
});

const webBridge = {
  getPlatform: () => 'web',
  startKernel: async () => 'n/a',
  stopKernel: async () => 'n/a',
} as unknown as PlatformBridge;

function wrapper({ children }: { children: ReactNode }) {
  return <PlatformProvider bridge={webBridge}>{children}</PlatformProvider>;
}

const STARTER = useEditorStore.getState().code;

describe('useKernel (web)', () => {
  beforeEach(async () => {
    controls.failBoot = false;
    controls.holdBoot = false;
    controls.releaseBoot = null;
    controls.executeCalls = 0;
    controls.parseReply = { snapshot: null, output: '', error: null };
    const { pyodideRuntime } = await import('../platform/pyodide/pyodideClient');
    pyodideRuntime.restart();
    useEditorStore.setState({
      code: STARTER, isDirty: false, filePath: null, framework: 'qiskit',
      kernelConnected: false, kernelReady: false, kernelStatus: 'idle', kernelError: null, kernelProgress: null,
    });
    useSimulationStore.setState({ terminalOutput: [], isRunning: false, result: null });
  });
  afterEach(() => { cleanup(); });

  it('never rewrites the editor or marks it dirty while the kernel boots', async () => {
    controls.holdBoot = true;
    renderHook(() => useKernel(), { wrapper });
    await waitFor(() => expect(controls.releaseBoot).not.toBeNull());

    // The student starts typing during the load...
    act(() => useEditorStore.getState().setCode(`${STARTER}qc.x(1)  # my edit\n`));
    expect(useEditorStore.getState().kernelReady).toBe(false);
    expect(useEditorStore.getState().kernelProgress?.label).toBe('Downloading Python');

    act(() => controls.releaseBoot?.());
    await waitFor(() => expect(useEditorStore.getState().kernelReady).toBe(true));
    expect(useEditorStore.getState().code).toBe(`${STARTER}qc.x(1)  # my edit\n`);
    expect(useEditorStore.getState().kernelProgress).toBeNull();
  });

  it('leaves an untouched starter clean so closing the tab does not prompt', async () => {
    renderHook(() => useKernel(), { wrapper });
    await waitFor(() => expect(useEditorStore.getState().kernelReady).toBe(true));
    expect(useEditorStore.getState().code).toBe(STARTER);
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it('reports a failed Python load once, with a human message, and recovers on retry', async () => {
    controls.failBoot = true;
    renderHook(() => useKernel(), { wrapper });
    await waitFor(() => expect(useEditorStore.getState().kernelStatus).toBe('failed'));

    expect(useEditorStore.getState().kernelError).toMatch(/Couldn't start the browser Python engine/);
    const errors = useSimulationStore.getState().terminalOutput.filter((l) => l.type === 'stderr');
    expect(errors).toHaveLength(1);

    controls.failBoot = false;
    act(() => retryKernel());
    await waitFor(() => expect(useEditorStore.getState().kernelStatus).toBe('ready'));
    expect(useEditorStore.getState().kernelError).toBeNull();
    const texts = useSimulationStore.getState().terminalOutput.map((l) => l.text);
    expect(texts[texts.length - 1]).toBe('Python ready');
  });

  it('does not announce Python ready after a normal first boot', async () => {
    renderHook(() => useKernel(), { wrapper });
    await waitFor(() => expect(useEditorStore.getState().kernelStatus).toBe('ready'));
    expect(useSimulationStore.getState().terminalOutput.map((l) => l.text)).not.toContain('Python ready');
  });

  it('keeps live-preview output and errors out of the Terminal', async () => {
    renderHook(() => useKernel(), { wrapper });
    await waitFor(() => expect(useEditorStore.getState().kernelReady).toBe(true));
    const focus = vi.spyOn(useBottomPanelStore.getState(), 'focusTerminal');
    useSimulationStore.setState({ terminalOutput: [] });

    controls.parseReply = {
      snapshot: null,
      output: 'leak\n',
      error: 'Traceback (most recent call last):\n  File "<string>", line 3, in <module>\nNameError: name \'q0\' is not defined',
    };
    act(() => useEditorStore.getState().setCode('print("leak")\nq0\n'));
    await waitFor(() => expect(useEditorStore.getState().errors).toHaveLength(1), { timeout: 2000 });

    expect(useSimulationStore.getState().terminalOutput).toEqual([]);
    expect(focus).not.toHaveBeenCalled();
    expect(useEditorStore.getState().errors[0].line).toBe(3);
  });

  it('ignores a second Run while one is already in flight', async () => {
    const { result } = renderHook(() => useKernel(), { wrapper });
    await waitFor(() => expect(useEditorStore.getState().kernelReady).toBe(true));

    act(() => { result.current.execute(); result.current.execute(); result.current.execute(); });
    await waitFor(() => expect(useSimulationStore.getState().isRunning).toBe(false));
    expect(controls.executeCalls).toBe(1);
    const separators = useSimulationStore.getState().terminalOutput.filter((l) => l.type === 'separator');
    expect(separators).toHaveLength(1);
  });

  it('queues a Run requested while Python boots and starts it when ready', async () => {
    controls.holdBoot = true;
    const { result } = renderHook(() => useKernel(), { wrapper });
    await waitFor(() => expect(controls.releaseBoot).not.toBeNull());

    act(() => result.current.execute());
    expect(controls.executeCalls).toBe(0);
    expect(useSimulationStore.getState().terminalOutput.some((l) => /queued/i.test(l.text))).toBe(true);

    act(() => controls.releaseBoot?.());
    await waitFor(() => expect(controls.executeCalls).toBe(1));
  });
});
