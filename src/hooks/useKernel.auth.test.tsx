// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { PlatformProvider } from '../platform/PlatformProvider';
import type { PlatformBridge } from '../platform/bridge';
import { useEditorStore } from '../stores/editorStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useKernel } from './useKernel';

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

    ws.receive({ type: 'authenticated' });
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
    ws.receive({ type: 'authenticated' });
    ws.closeFromServer(1006);
    await vi.advanceTimersByTimeAsync(2_500);
    await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(1));
  });
});
