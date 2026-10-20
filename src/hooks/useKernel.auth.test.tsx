// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { PlatformProvider } from '../platform/PlatformProvider';
import type { PlatformBridge } from '../platform/bridge';
import { useEditorStore } from '../stores/editorStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useKernel } from './useKernel';
import { retryKernel } from '../lib/kernelControl';
import { ackForSent } from '../test/kernelAuthProof';

class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly OPEN = 1;
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readyState = 0;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    (this.listeners.get('open') ?? []).forEach((l) => l({}));
    this.onopen?.();
  }

  receive(data: unknown) {
    const event = {
      data: JSON.stringify(data),
      stopped: false,
      stopImmediatePropagation() { this.stopped = true; },
    };
    for (const l of this.listeners.get('message') ?? []) {
      l(event);
      if (event.stopped) return;
    }
    this.onmessage?.(event);
  }

  closeFromServer(code: number) {
    this.readyState = 3;
    (this.listeners.get('close') ?? []).forEach((l) => l({ code }));
    this.onclose?.({ code });
  }
}

const bridge = {
  getPlatform: () => 'desktop',
  startKernel: async () => 'started',
  stopKernel: async () => 'stopped',
  getKernelAuthToken: async () => 'tok',
} as unknown as PlatformBridge;

function wrapper({ children }: { children: ReactNode }) {
  return <PlatformProvider bridge={bridge}>{children}</PlatformProvider>;
}

async function socketAfterMount(): Promise<FakeSocket> {
  renderHook(() => useKernel(), { wrapper });
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  return FakeSocket.instances[0];
}

describe('useKernel authentication', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    useEditorStore.setState({
      kernelConnected: false, kernelReady: false, kernelStatus: 'idle', kernelError: null, code: '',
    });
    useSimulationStore.getState().clearOutput?.();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('stays connecting after the socket opens and only becomes connected on the ack', async () => {
    const ws = await socketAfterMount();
    ws.open();
    await Promise.resolve();
    expect(useEditorStore.getState().kernelConnected).toBe(false);
    expect(useEditorStore.getState().kernelStatus).toBe('connecting');

    ws.receive(ackForSent(ws.sent, 'tok'));
    await waitFor(() => expect(useEditorStore.getState().kernelConnected).toBe(true));
    expect(useEditorStore.getState().kernelStatus).toBe('ready');
  });

  it('shows a clear error and does not reconnect when the kernel closes with 4401', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ws = await socketAfterMount();
    ws.open();
    ws.closeFromServer(4401);

    await waitFor(() => expect(useEditorStore.getState().kernelStatus).toBe('failed'));
    const state = useEditorStore.getState();
    expect(state.kernelConnected).toBe(false);
    expect(state.kernelError).toBe('Kernel rejected the session token — restart Nuclei');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    const rejected = useSimulationStore.getState().terminalOutput.filter((l) => l.text.includes('rejected the session token'));
    expect(rejected).toHaveLength(1);
  });

  it('still retries after an ordinary connection drop', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ws = await socketAfterMount();
    ws.open();
    ws.receive(ackForSent(ws.sent, 'tok'));
    ws.closeFromServer(1006);
    await vi.advanceTimersByTimeAsync(2_500);
    await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(1));
  });
});

describe('useKernel mutual authentication', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    useEditorStore.setState({
      kernelConnected: false, kernelReady: false, kernelStatus: 'idle', kernelError: null, code: '',
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('fails with a clear error and does not retry when the ack carries no valid proof', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ws = await socketAfterMount();
    ws.open();
    ws.receive({ type: 'authenticated' }); // what a 0.14.0 or squatting kernel would say
    await waitFor(() => expect(useEditorStore.getState().kernelStatus).toBe('failed'));
    expect(useEditorStore.getState().kernelError).toMatch(/could not prove it is the Nuclei kernel/);
    expect(useEditorStore.getState().kernelConnected).toBe(false);
    ws.closeFromServer(1000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe('useKernel fail-closed start', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    useEditorStore.setState({
      kernelConnected: false, kernelReady: false, kernelStatus: 'idle', kernelError: null, code: '',
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function failingWrapper(startKernel: () => Promise<string>) {
    const failing = { ...bridge, startKernel } as unknown as PlatformBridge;
    return function Wrapper({ children }: { children: ReactNode }) {
      return <PlatformProvider bridge={failing}>{children}</PlatformProvider>;
    };
  }

  it('surfaces the start_kernel error and never opens a socket (upgrade PoC)', async () => {
    const startKernel = vi.fn(async () => { throw new Error('Port 9742 is already in use'); });
    renderHook(() => useKernel(), { wrapper: failingWrapper(startKernel) });
    await waitFor(() => expect(useEditorStore.getState().kernelStatus).toBe('failed'));
    // The failure banner supplies the "couldn't start" heading (lib/kernelErrors); the status keeps the Rust reason.
    expect(useEditorStore.getState().kernelError).toBe('Port 9742 is already in use');
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('retries start_kernel when the user hits Retry', async () => {
    let calls = 0;
    const startKernel = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return 'started';
    });
    renderHook(() => useKernel(), { wrapper: failingWrapper(startKernel) });
    await waitFor(() => expect(useEditorStore.getState().kernelStatus).toBe('failed'));
    retryKernel();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(startKernel).toHaveBeenCalledTimes(2);
  });

  it('does not connect when the token provider fails after a successful start', async () => {
    const noToken = {
      ...bridge,
      getKernelAuthToken: async () => { throw new Error('Kernel is not running'); },
    } as unknown as PlatformBridge;
    renderHook(() => useKernel(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PlatformProvider bridge={noToken}>{children}</PlatformProvider>
      ),
    });
    await waitFor(() => expect(useEditorStore.getState().kernelStatus).toBe('failed'));
    expect(useEditorStore.getState().kernelError).toMatch(/token unavailable/);
    expect(FakeSocket.instances).toHaveLength(0);
  });
});
