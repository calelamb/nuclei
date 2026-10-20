// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KernelAuthRejectedError, KernelProofError } from '../../services/kernelSocket';

const openKernelConnection = vi.fn();
vi.mock('../../services/kernelSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/kernelSocket')>();
  return { ...actual, openKernelConnection: (...args: unknown[]) => openKernelConnection(...args) };
});
vi.mock('../../platform/PlatformProvider', () => ({
  usePlatform: () => ({ getPlatform: () => 'desktop', getKernelAuthToken: async () => 'token' }),
}));

import { useLessonKernel } from './useLessonKernel';

class FakeSocket {
  readyState = 1;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => { this.onclose?.(); });
  send = vi.fn();
}

function connection(outcome: 'ok' | Error) {
  const ws = new FakeSocket();
  const authenticated = outcome === 'ok' ? Promise.resolve() : Promise.reject(outcome);
  authenticated.catch(() => undefined);
  return { ws, authenticated };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.useFakeTimers();
  openKernelConnection.mockReset();
  (globalThis as unknown as { WebSocket: { OPEN: number } }).WebSocket = { OPEN: 1 } as never;
});
afterEach(() => { vi.useRealTimers(); });

describe('useLessonKernel desktop socket', () => {
  it('reports ready only after the kernel proves it knows the token', async () => {
    let resolveAuth!: () => void;
    const ws = new FakeSocket();
    openKernelConnection.mockResolvedValue({ ws, authenticated: new Promise<void>((r) => { resolveAuth = r; }) });
    const onReady = vi.fn();
    const { result } = renderHook(() => useLessonKernel({ onMessage: vi.fn(), onInitError: vi.fn(), onReady }));
    await flush();
    expect(onReady).not.toHaveBeenCalled();
    expect(await result.current.send({ type: 'execute' })).toBe(false);
    await act(async () => { resolveAuth(); await Promise.resolve(); });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(await result.current.send({ type: 'execute' })).toBe(true);
  });

  it.each([new KernelAuthRejectedError(), new KernelProofError()])('never retries after %s', async (err) => {
    const first = connection(err);
    openKernelConnection.mockResolvedValue(first);
    renderHook(() => useLessonKernel({ onMessage: vi.fn(), onInitError: vi.fn() }));
    await flush();
    act(() => { first.ws.onclose?.(); });
    await act(async () => { vi.advanceTimersByTime(10_000); await Promise.resolve(); });
    expect(openKernelConnection).toHaveBeenCalledTimes(1);
  });

  it('retries an ordinary drop a bounded number of times', async () => {
    openKernelConnection.mockImplementation(async () => connection(new Error('closed before auth')));
    renderHook(() => useLessonKernel({ onMessage: vi.fn(), onInitError: vi.fn() }));
    for (let i = 0; i < 6; i++) {
      await flush();
      const ws = openKernelConnection.mock.results.at(-1)?.value;
      const conn = await ws;
      act(() => { conn.ws.onclose?.(); });
      await act(async () => { vi.advanceTimersByTime(5_000); await Promise.resolve(); });
    }
    expect(openKernelConnection.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('fails closed when no token is available', async () => {
    openKernelConnection.mockRejectedValue(new Error('token unavailable'));
    const onReady = vi.fn();
    const { result } = renderHook(() => useLessonKernel({ onMessage: vi.fn(), onInitError: vi.fn(), onReady }));
    await flush();
    expect(onReady).not.toHaveBeenCalled();
    expect(await result.current.send({ type: 'execute' })).toBe(false);
  });
});
