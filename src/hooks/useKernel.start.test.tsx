// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { PlatformProvider } from '../platform/PlatformProvider';
import type { PlatformBridge } from '../platform/bridge';
import { useEditorStore } from '../stores/editorStore';
import { useSimulationStore } from '../stores/simulationStore';
import { retryKernel } from '../lib/kernelControl';
import { KERNEL_NOT_RESPONDING_MESSAGE } from '../lib/kernelErrors';
import { useKernel } from './useKernel';

class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly OPEN = 1;
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readyState = 0;

  constructor(readonly url: string) { FakeSocket.instances.push(this); }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send() { /* not needed */ }
  close() { this.readyState = 3; }
  closeFromServer(code: number) {
    this.readyState = 3;
    (this.listeners.get('close') ?? []).forEach((l) => l({ code }));
    this.onclose?.({ code });
  }
}

const RUST_ERROR = 'Port 8742 is already in use by another application. Close it and retry.';

function makeBridge(startKernel: () => Promise<string>) {
  const stopKernel = vi.fn(async () => 'stopped');
  const bridge = {
    getPlatform: () => 'desktop',
    startKernel,
    stopKernel,
    getKernelAuthToken: async () => 'tok',
  } as unknown as PlatformBridge;
  return { bridge, stopKernel };
}

function mount(bridge: PlatformBridge) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider bridge={bridge}>{children}</PlatformProvider>
  );
  return renderHook(() => useKernel(), { wrapper });
}

describe('useKernel desktop start', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    useEditorStore.setState({
      kernelConnected: false, kernelReady: false, kernelStatus: 'idle', kernelError: null, kernelProgress: null,
    });
    useSimulationStore.setState({ terminalOutput: [], isRunning: false });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the Rust start error verbatim instead of hanging on "Loading kernel"', async () => {
    const start = vi.fn(async () => { throw RUST_ERROR; });
    const { bridge } = makeBridge(start);
    mount(bridge);

    await waitFor(() => expect(useEditorStore.getState().kernelStatus).toBe('failed'));
    expect(useEditorStore.getState().kernelError).toBe(RUST_ERROR);
    expect(FakeSocket.instances).toHaveLength(0); // never tried to connect to a dead process
    const errors = useSimulationStore.getState().terminalOutput.filter((l) => l.type === 'stderr');
    expect(errors).toHaveLength(1);
    expect(errors[0].text).toContain(RUST_ERROR);
  });

  it('Retry stops the stale kernel, starts again and connects', async () => {
    let attempts = 0;
    const start = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw RUST_ERROR;
      return 'started';
    });
    const { bridge, stopKernel } = makeBridge(start);
    mount(bridge);
    await waitFor(() => expect(useEditorStore.getState().kernelStatus).toBe('failed'));

    act(() => retryKernel());
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(stopKernel).toHaveBeenCalled();
    expect(useEditorStore.getState().kernelStatus).toBe('connecting');
    expect(useEditorStore.getState().kernelError).toBeNull();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  });

  it('gives up after the retry budget with an actionable message and reports progress while trying', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { bridge } = makeBridge(async () => 'started');
    mount(bridge);
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));

    FakeSocket.instances[0].closeFromServer(1006);
    expect(useEditorStore.getState().kernelProgress?.label).toMatch(/Connecting to the kernel \(1\/15\)/);

    for (let i = 0; i < 16; i++) {
      await vi.advanceTimersByTimeAsync(2_100);
      const latest = FakeSocket.instances[FakeSocket.instances.length - 1];
      latest.closeFromServer(1006);
    }
    await waitFor(() => expect(useEditorStore.getState().kernelStatus).toBe('failed'));
    expect(useEditorStore.getState().kernelError).toBe(KERNEL_NOT_RESPONDING_MESSAGE);
    expect(useEditorStore.getState().kernelProgress).toBeNull();
  });
});
