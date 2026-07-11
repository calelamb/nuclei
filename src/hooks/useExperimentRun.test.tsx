// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PlatformProvider } from '../platform/PlatformProvider';
import type { PlatformBridge } from '../platform/bridge';
import { useExperimentRun } from './useExperimentRun';
import { useExperimentRunStore } from '../stores/experimentRunStore';
import { useExperimentStore, type DiscoveredExperiment } from '../services/experimentStore';
import { resetEnvironmentCache } from '../services/kernelEnvironment';
import type { KernelMessage, KernelResponse, SimulationResult } from '../types/quantum';

/**
 * PRD 09 Phase D (D4/D5) — verifies the hook's wiring: a dedicated kernel
 * session is opened and closed around the sweep, `runExperiment`'s progress
 * events land in `experimentRunStore` (driving the runs-table streaming +
 * status-bar indicator), and cancel flips the runner's abort signal so the
 * sweep stops after the in-flight point. `runExperiment` itself (ordering,
 * manifest shape, failure handling) is already exhaustively covered in
 * `experimentRunner.test.ts` — this test is about the hook's plumbing.
 */

const createKernelSessionMock = vi.hoisted(() => vi.fn());
vi.mock('../services/kernelSession', () => ({
  createKernelSession: createKernelSessionMock,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(async () => {}),
  writeTextFile: vi.fn(async () => {}),
  readDir: vi.fn(async () => []),
  readTextFile: vi.fn(async () => ''),
  exists: vi.fn(async () => false),
  watch: vi.fn(async () => () => {}),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));

const sendMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());
let onMessage: ((message: KernelResponse) => void) | null = null;

function simResult(measurements: Record<string, number>): SimulationResult {
  return {
    state_vector: [], probabilities: {}, measurements, bloch_coords: [],
    execution_time_ms: 1, shot_count: 100, metrics: {},
  };
}

const desktopBridge: PlatformBridge = {
  async startKernel() { return 'ok'; },
  async stopKernel() { return 'ok'; },
  async openFile() { return null; },
  async readFile() { return 'print("hi")'; },
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

function wrapper({ children }: { children: ReactNode }) {
  return <PlatformProvider bridge={desktopBridge}>{children}</PlatformProvider>;
}

const EXPERIMENT: DiscoveredExperiment = {
  fileName: 'theta-sweep.experiment.yaml',
  path: '/proj/experiments/theta-sweep.experiment.yaml',
  spec: {
    schema: 1,
    name: 'theta-sweep',
    entry: 'run.py',
    language: 'python',
    backend: { provider: 'simulator', target: 'statevector' },
    shots: 100,
    seed: 42,
    sweep: { theta: { values: [0, 1] } },
  },
};

describe('useExperimentRun', () => {
  beforeEach(() => {
    resetEnvironmentCache();
    onMessage = null;
    sendMock.mockReset();
    closeMock.mockReset();
    sendMock.mockImplementation((message: KernelMessage) => {
      queueMicrotask(() => {
        if (message.type === 'execute') {
          onMessage?.({ type: 'result', data: simResult({ '00': 100 }) });
        } else if (message.type === 'environment') {
          onMessage?.({ type: 'environment', python: '3.12.4', platform: 'darwin', packages: {} });
        }
      });
    });
    createKernelSessionMock.mockReset();
    createKernelSessionMock.mockImplementation(
      async (_kind: string, handler: (message: KernelResponse) => void) => {
        onMessage = handler;
        return { send: sendMock, close: closeMock };
      },
    );
    useExperimentRunStore.setState({ active: null, lastSummary: null, lastError: null });
    useExperimentStore.setState({
      loading: false,
      experiments: [EXPERIMENT],
      validationErrors: [],
      runsByExperiment: {},
      reload: vi.fn(async () => {}),
      scanRuns: vi.fn(async () => {}),
      startWatching: vi.fn(async () => {}),
      stopWatching: vi.fn(),
    });
  });

  it('opens a dedicated kernel session, streams progress, and closes on completion', async () => {
    const { result } = renderHook(() => useExperimentRun(), { wrapper });

    await act(async () => {
      await result.current.run(EXPERIMENT, '/proj');
    });

    expect(createKernelSessionMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);

    const state = useExperimentRunStore.getState();
    expect(state.active).toBeNull();
    expect(state.lastSummary?.total).toBe(2);
    expect(state.lastSummary?.completed).toBe(2);
    expect(state.lastError).toBeNull();

    // Streamed rows: the runs table re-scans after every point completes.
    expect(useExperimentStore.getState().scanRuns).toHaveBeenCalledTimes(2);
  });

  it('does not open a second session while a sweep is already active', async () => {
    // Never resolves the first point, so the first run() call stays "active".
    sendMock.mockImplementation(() => {});
    const { result } = renderHook(() => useExperimentRun(), { wrapper });

    void result.current.run(EXPERIMENT, '/proj');
    await act(async () => {
      await Promise.resolve(); // let the first run() reach `start()`
    });
    expect(useExperimentRunStore.getState().active).not.toBeNull();

    await act(async () => {
      await result.current.run(EXPERIMENT, '/proj');
    });
    expect(createKernelSessionMock).toHaveBeenCalledTimes(1);
  });

  it('cancel() stops the sweep after the in-flight point (stop-after-current-point)', async () => {
    const { result } = renderHook(() => useExperimentRun(), { wrapper });

    // Cancel the instant the first point's progress lands — synchronously
    // ahead of the runner's next loop iteration, which is exactly the
    // "stop after the current point" contract experimentRunner.ts documents.
    const unsubscribe = useExperimentRunStore.subscribe((state) => {
      if (state.active?.progress.completed === 1) {
        state.active.cancel();
      }
    });

    await act(async () => {
      await result.current.run(EXPERIMENT, '/proj');
    });
    unsubscribe();

    const state = useExperimentRunStore.getState();
    expect(state.lastSummary?.cancelled).toBe(true);
    expect(state.lastSummary?.completed).toBe(1);
    expect(state.lastSummary?.total).toBe(2);
    expect(closeMock).toHaveBeenCalledTimes(1);
    // Only one `execute` was ever sent — the sweep never started point 2.
    const executeSends = sendMock.mock.calls.filter(([m]) => (m as KernelMessage).type === 'execute');
    expect(executeSends).toHaveLength(1);
  });

  it('records a store error (without throwing) when opening the session fails', async () => {
    createKernelSessionMock.mockRejectedValueOnce(new Error('kernel unreachable'));
    const { result } = renderHook(() => useExperimentRun(), { wrapper });

    await act(async () => {
      await result.current.run(EXPERIMENT, '/proj');
    });

    expect(useExperimentRunStore.getState().active).toBeNull();
    expect(useExperimentRunStore.getState().lastError).toBe('kernel unreachable');
  });
});
