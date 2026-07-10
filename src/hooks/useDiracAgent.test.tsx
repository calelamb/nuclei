// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PlatformProvider } from '../platform/PlatformProvider';
import type { PlatformBridge } from '../platform/bridge';
import { useDiracAgent } from './useDiracAgent';
import { useAgentRunStore } from '../stores/agentRunStore';
import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
const unlistenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

type RunEventHandler = (event: { payload: unknown }) => void;

const desktopBridge: PlatformBridge = {
  async startKernel() { return 'ok'; },
  async stopKernel() { return 'ok'; },
  async openFile() { return null; },
  async readFile() { return null; },
  async saveFile() {},
  async saveFileAs() { return null; },
  async renameFile() { return null; },
  async getStoredValue() { return null; },
  async setStoredValue() {},
  async setWindowTitle() {},
  getPlatform() { return 'desktop'; },
  async openDirectory() { return null; },
  async listDirectory() { return null; },
  async createFile() { return null; },
  async createDirectory() { return null; },
  async deleteFile() { return false; },
};

const webBridge: PlatformBridge = { ...desktopBridge, getPlatform: () => 'web' };

function desktopWrapper({ children }: { children: ReactNode }) {
  return <PlatformProvider bridge={desktopBridge}>{children}</PlatformProvider>;
}

function webWrapper({ children }: { children: ReactNode }) {
  return <PlatformProvider bridge={webBridge}>{children}</PlatformProvider>;
}

function resetAll() {
  useAgentRunStore.getState().reset();
  useProjectStore.setState({ projectRoot: null, tabs: [], activeTabPath: null });
  useEditorStore.setState({
    code: 'original code',
    framework: 'qiskit',
    lastPythonFramework: 'qiskit',
    filePath: null,
    isDirty: false,
  });
}

describe('useDiracAgent (Rust harness wiring)', () => {
  let capturedHandler: RunEventHandler | null = null;

  beforeEach(() => {
    resetAll();
    capturedHandler = null;
    invokeMock.mockReset();
    listenMock.mockReset();
    unlistenMock.mockReset();
    listenMock.mockImplementation(async (_channel: string, handler: RunEventHandler) => {
      capturedHandler = handler;
      return unlistenMock;
    });
  });

  afterEach(() => {
    cleanup();
    resetAll();
  });

  it('fails immediately on web without touching Tauri APIs', async () => {
    const { result } = renderHook(() => useDiracAgent(), { wrapper: webWrapper });

    await act(async () => {
      await result.current.start('build a bell state');
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(listenMock).not.toHaveBeenCalled();
    expect(useAgentRunStore.getState().activeRun?.success).toBe(false);
    expect(useAgentRunStore.getState().activeRun?.summary).toBe('Agent mode requires the desktop app.');
  });

  it('fails with a guard message when no API key is stored', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'dirac_has_api_key') return false;
      throw new Error(`unexpected command ${cmd}`);
    });

    const { result } = renderHook(() => useDiracAgent(), { wrapper: desktopWrapper });

    await act(async () => {
      await result.current.start('build a bell state');
    });

    expect(useAgentRunStore.getState().activeRun?.success).toBe(false);
    expect(useAgentRunStore.getState().activeRun?.summary).toBe(
      'Add your Anthropic API key in Settings before running the agent.',
    );
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('starts a run, streams events onto the store, applies a patch to the active file, and finishes successfully', async () => {
    useProjectStore.setState({ activeTabPath: 'bell.py' });

    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'dirac_has_api_key') return true;
      if (cmd === 'dirac_start_run') {
        expect(args?.goal).toBe('build a bell state');
        expect(args?.activePath).toBe('bell.py');
        expect(args?.files).toEqual([{ path: 'bell.py', framework: 'qiskit', content: 'original code' }]);
        return 'run_xyz';
      }
      throw new Error(`unexpected command ${cmd}`);
    });

    const { result } = renderHook(() => useDiracAgent(), { wrapper: desktopWrapper });

    await act(async () => {
      await result.current.start('build a bell state');
    });

    expect(listenMock).toHaveBeenCalledWith('dirac://run-event', expect.any(Function));
    expect(capturedHandler).not.toBeNull();
    expect(useAgentRunStore.getState().activeRun?.runId).toBe('run_xyz');
    expect(useAgentRunStore.getState().isRunning).toBe(true);

    act(() => {
      capturedHandler?.({ payload: { kind: 'started', runId: 'run_xyz', goal: 'build a bell state' } });
      capturedHandler?.({ payload: { kind: 'state', runId: 'run_xyz', state: 'working' } });
    });
    expect(useAgentRunStore.getState().activeRun?.state).toBe('working');

    act(() => {
      capturedHandler?.({
        payload: { kind: 'toolCall', runId: 'run_xyz', toolCallId: 'c1', tool: 'apply_patch', input: { path: 'bell.py' } },
      });
    });
    expect(useAgentRunStore.getState().activeRun?.iterations).toBe(1);

    act(() => {
      capturedHandler?.({
        payload: {
          kind: 'toolResult',
          runId: 'run_xyz',
          toolCallId: 'c1',
          tool: 'apply_patch',
          ok: true,
          facts: { path: 'bell.py' },
          diagnostics: null,
        },
      });
    });

    act(() => {
      capturedHandler?.({
        payload: {
          kind: 'patch',
          runId: 'run_xyz',
          path: 'bell.py',
          beforeContent: 'original code',
          afterContent: 'patched code',
          transactionId: 'txn_1',
        },
      });
    });
    // Patch targets the active file — the editor buffer picks it up.
    expect(useEditorStore.getState().code).toBe('patched code');
    expect(useAgentRunStore.getState().activeRun?.patches).toHaveLength(1);
    expect(useAgentRunStore.getState().activeRun?.patches[0]).toMatchObject({
      id: 'txn_1',
      path: 'bell.py',
      beforeContent: 'original code',
      afterContent: 'patched code',
      rolledBack: false,
    });

    act(() => {
      capturedHandler?.({ payload: { kind: 'state', runId: 'run_xyz', state: 'completed' } });
      capturedHandler?.({
        payload: { kind: 'finished', runId: 'run_xyz', success: true, iterations: 1, summary: 'Done.' },
      });
    });

    await waitFor(() => {
      expect(useAgentRunStore.getState().isRunning).toBe(false);
    });
    expect(useAgentRunStore.getState().activeRun?.state).toBe('completed');
    expect(useAgentRunStore.getState().activeRun?.success).toBe(true);
    expect(useAgentRunStore.getState().activeRun?.summary).toBe('Done.');
    expect(unlistenMock).toHaveBeenCalledTimes(1);
  });

  it('ignores events for a stale run id and does not apply a patch targeting a different file', async () => {
    useProjectStore.setState({ activeTabPath: 'bell.py' });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'dirac_has_api_key') return true;
      if (cmd === 'dirac_start_run') return 'run_current';
      throw new Error(`unexpected command ${cmd}`);
    });

    const { result } = renderHook(() => useDiracAgent(), { wrapper: desktopWrapper });
    await act(async () => {
      await result.current.start('goal');
    });

    act(() => {
      // A stray event from an old run — must be ignored.
      capturedHandler?.({ payload: { kind: 'state', runId: 'run_stale', state: 'working' } });
    });
    expect(useAgentRunStore.getState().activeRun?.state).toBe('planning');

    act(() => {
      capturedHandler?.({
        payload: {
          kind: 'patch',
          runId: 'run_current',
          path: 'other_file.py',
          beforeContent: 'a',
          afterContent: 'b',
          transactionId: 'txn_2',
        },
      });
    });
    // Patch recorded in the run's patch list, but the editor (showing bell.py) is untouched.
    expect(useEditorStore.getState().code).toBe('original code');
    expect(useAgentRunStore.getState().activeRun?.patches).toHaveLength(1);
  });

  it('cancel() invokes dirac_cancel_run with the active run id', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'dirac_has_api_key') return true;
      if (cmd === 'dirac_start_run') return 'run_cancel_me';
      if (cmd === 'dirac_cancel_run') return true;
      throw new Error(`unexpected command ${cmd}`);
    });

    const { result } = renderHook(() => useDiracAgent(), { wrapper: desktopWrapper });
    await act(async () => {
      await result.current.start('goal');
    });

    act(() => {
      result.current.cancel();
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('dirac_cancel_run', { runId: 'run_cancel_me' });
    });
  });

  it('cancel() is a no-op when no run is active', () => {
    const { result } = renderHook(() => useDiracAgent(), { wrapper: desktopWrapper });
    result.current.cancel();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
