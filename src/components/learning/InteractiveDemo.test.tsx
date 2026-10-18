// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const boot = vi.hoisted(() => {
  const state = {
    resolveInit: () => {},
    sent: [] as Array<Record<string, unknown>>,
    onMessage: (() => {}) as (m: unknown) => void,
    progress: null as ((p: { step: number; total: number; label: string; fraction: number } | null) => void) | null,
    stateCb: null as ((s: string) => void) | null,
    failInit: false,
    inits: 0,
  };
  return state;
});

vi.mock('../../platform/PlatformProvider', () => ({
  usePlatform: () => ({ getPlatform: () => 'web', getKernelAuthToken: undefined }),
}));
vi.mock('./LessonCodeEditor', () => ({ LessonCodeEditor: () => <div /> }));
vi.mock('../../platform/pyodide/pyodideClient', () => ({
  pyodideRuntime: {
    isReady: () => false,
    onProgress: (cb: (p: { step: number; total: number; label: string; fraction: number } | null) => void) => { boot.progress = cb; return () => {}; },
    onState: (cb: (s: string) => void) => { boot.stateCb = cb; return () => {}; },
  },
}));
vi.mock('../../platform/pyodideKernel', () => ({
  PyodideKernel: class {
    constructor(onMessage: (m: unknown) => void) { boot.onMessage = onMessage; }
    init() {
      boot.inits += 1;
      if (boot.failInit) return Promise.reject(new Error("Couldn't start the browser Python engine. Check your connection or content blocker, then retry."));
      return new Promise<void>((resolve) => { boot.resolveInit = resolve; });
    }
    async send(msg: Record<string, unknown>) { boot.sent.push(msg); }
  },
}));

import { InteractiveDemo } from './InteractiveDemo';

const CODE = 'from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.h(0)';

beforeEach(() => { boot.sent = []; boot.failInit = false; boot.inits = 0; });
afterEach(cleanup);

describe('InteractiveDemo on the web before Python is ready', () => {
  it('queues Run instead of showing the desktop-only kernel error', async () => {
    render(<InteractiveDemo code={CODE} framework="qiskit" description="demo" />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { boot.progress?.({ step: 1, total: 3, label: 'Downloading Python', fraction: 0 }); });

    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    expect(screen.queryByText(/Kernel not connected/)).toBeNull();
    expect(screen.getByRole('button', { name: /Queued · 1\/3/ })).toBeTruthy();
    expect(boot.sent.filter((m) => m.type === 'execute')).toHaveLength(0);

    await act(async () => { boot.resolveInit(); await Promise.resolve(); });
    expect(boot.sent.filter((m) => m.type === 'execute')).toHaveLength(1);
    expect(screen.queryByText(/Kernel not connected/)).toBeNull();
  });

  it('shares the toolbar queue model: Run until pressed, Queued while waiting, a second press cancels', async () => {
    render(<InteractiveDemo code={CODE} framework="qiskit" description="demo" />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { boot.progress?.({ step: 2, total: 3, label: 'Loading NumPy', fraction: 0.6 }); });
    expect(screen.getByRole('button', { name: /^Run$/ }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    const queued = screen.getByRole('button', { name: /Queued · 2\/3/ });
    expect(queued.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(queued);
    expect(screen.getByRole('button', { name: /^Run$/ })).toBeTruthy();
    await act(async () => { boot.resolveInit(); await Promise.resolve(); await Promise.resolve(); });
    expect(boot.sent.filter((m) => m.type === 'execute')).toHaveLength(0);
  });

  it('re-sends the live parse once Python is ready so the circuit summary can appear', async () => {
    render(<InteractiveDemo code={CODE} framework="qiskit" description="demo" />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { boot.resolveInit(); await Promise.resolve(); });
    expect(boot.sent.some((m) => m.type === 'parse')).toBe(true);
  });
});

describe('InteractiveDemo on the web when Python fails to start', () => {
  it('keeps the web error on Run (never the desktop sentence) and retries the boot', async () => {
    boot.failInit = true;
    render(<InteractiveDemo code={CODE} framework="qiskit" description="demo" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText(/Couldn't start the browser Python engine/)).toBeTruthy();
    expect(boot.inits).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(boot.inits).toBe(2);
    expect(screen.queryByText(/Kernel not connected/)).toBeNull();
    expect(screen.getByText(/Couldn't start the browser Python engine/)).toBeTruthy();
  });
});
