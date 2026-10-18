// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const boot = vi.hoisted(() => {
  const state = {
    resolveInit: () => {},
    sent: [] as Array<Record<string, unknown>>,
    onMessage: (() => {}) as (m: unknown) => void,
    progress: null as ((p: { label: string } | null) => void) | null,
    stateCb: null as ((s: string) => void) | null,
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
    onProgress: (cb: (p: { label: string } | null) => void) => { boot.progress = cb; return () => {}; },
    onState: (cb: (s: string) => void) => { boot.stateCb = cb; return () => {}; },
  },
}));
vi.mock('../../platform/pyodideKernel', () => ({
  PyodideKernel: class {
    constructor(onMessage: (m: unknown) => void) { boot.onMessage = onMessage; }
    init() { return new Promise<void>((resolve) => { boot.resolveInit = resolve; }); }
    async send(msg: Record<string, unknown>) { boot.sent.push(msg); }
  },
}));

import { InteractiveDemo } from './InteractiveDemo';

const CODE = 'from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.h(0)';

beforeEach(() => { boot.sent = []; });
afterEach(cleanup);

describe('InteractiveDemo on the web before Python is ready', () => {
  it('queues Run instead of showing the desktop-only kernel error', async () => {
    render(<InteractiveDemo code={CODE} framework="qiskit" description="demo" />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { boot.progress?.({ label: 'Downloading Python' }); });

    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    expect(screen.queryByText(/Kernel not connected/)).toBeNull();
    expect(screen.getByRole('button', { name: /Loading Python/ })).toBeTruthy();
    expect(boot.sent.filter((m) => m.type === 'execute')).toHaveLength(0);

    await act(async () => { boot.resolveInit(); await Promise.resolve(); });
    expect(boot.sent.filter((m) => m.type === 'execute')).toHaveLength(1);
    expect(screen.queryByText(/Kernel not connected/)).toBeNull();
  });

  it('re-sends the live parse once Python is ready so the circuit summary can appear', async () => {
    render(<InteractiveDemo code={CODE} framework="qiskit" description="demo" />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { boot.resolveInit(); await Promise.resolve(); });
    expect(boot.sent.some((m) => m.type === 'parse')).toBe(true);
  });
});
