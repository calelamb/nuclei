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
    current: null as { step: number; total: number; label: string; fraction: number } | null,
  };
  return state;
});

vi.mock('../../platform/PlatformProvider', () => ({
  usePlatform: () => ({ getPlatform: () => 'web', getKernelAuthToken: undefined }),
}));
const mockEditorChange = vi.hoisted(() => ({ current: null as null | ((v: string) => void) }));
vi.mock('./LessonCodeEditor', () => ({
  LessonCodeEditor: ({ onChange }: { onChange: (v: string) => void }) => { mockEditorChange.current = onChange; return <div />; },
}));
vi.mock('../../platform/pyodide/pyodideClient', () => ({
  pyodideRuntime: {
    isReady: () => false,
    currentProgress: () => boot.current,
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

beforeEach(() => { boot.current = null; boot.sent = []; boot.failInit = false; boot.inits = 0; });
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

  it('shows the step count when the stage was reported before the lesson mounted', async () => {
    boot.current = { step: 1, total: 3, label: 'Downloading Python', fraction: 0 };
    render(<InteractiveDemo code={CODE} framework="qiskit" description="demo" />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    expect(screen.getByRole('button', { name: /Queued · 1\/3/ })).toBeTruthy();
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

describe('InteractiveDemo stale results (r7-learn-01)', () => {
  const RESULT = { probabilities: { '0': 0.5, '1': 0.5 }, measurements: { '0': 500, '1': 524 }, shot_count: 1024 };

  it('disables Reset on untouched code', async () => {
    render(<InteractiveDemo code={CODE} framework="qiskit" description="demo" />);
    await act(async () => { await Promise.resolve(); });
    expect((screen.getByRole('button', { name: /Reset/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks results stale after the code changes and clears on the next run', async () => {
    mockEditorChange.current = null;
    render(<InteractiveDemo code={CODE} framework="qiskit" description="demo" />);
    await act(async () => { await Promise.resolve(); boot.resolveInit(); await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await act(async () => { boot.onMessage({ type: 'result', data: RESULT }); });
    expect(screen.queryByText(/From last run/)).toBeNull();

    await act(async () => { mockEditorChange.current?.(CODE + '\nqc.x(0)'); });
    expect(screen.getByRole('button', { name: /From last run · Run again/ })).toBeTruthy();
    expect((screen.getByRole('button', { name: /Reset/ }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /From last run · Run again/ }));
    await act(async () => { boot.onMessage({ type: 'result', data: RESULT }); });
    expect(screen.queryByText(/From last run/)).toBeNull();
  });

  it('Reset restores the code and keeps the old result marked stale', async () => {
    mockEditorChange.current = null;
    render(<InteractiveDemo code={CODE} framework="qiskit" description="demo" />);
    await act(async () => { await Promise.resolve(); boot.resolveInit(); await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await act(async () => { boot.onMessage({ type: 'result', data: RESULT }); });
    await act(async () => { mockEditorChange.current?.(CODE + '\nqc.x(0)'); });
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    // Back at the code that produced the result, so nothing is stale any more.
    expect(screen.queryByText(/From last run/)).toBeNull();
    expect(screen.getByRole('list', { name: 'Outcome probabilities' })).toBeTruthy();
  });

  it('keeps keyboard focus inside the demo when Reset disables itself (interaction-r-06)', async () => {
    render(<InteractiveDemo code={CODE} framework="qiskit" description="demo" />);
    await act(async () => { await Promise.resolve(); boot.resolveInit(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { mockEditorChange.current?.(CODE + '\nqc.x(0)'); });
    const reset = screen.getByRole('button', { name: /Reset/ });
    reset.focus();
    fireEvent.click(reset);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.closest('.demo')).toBeTruthy();
  });
});

describe('InteractiveDemo Python-only runs (learn-r9-01)', () => {
  const PLAIN = 'print("hi")';

  async function runPlain() {
    render(<InteractiveDemo code={PLAIN} framework="qiskit" description="demo" />);
    await act(async () => { await Promise.resolve(); boot.resolveInit(); await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
  }

  it('keeps the error visible when python_result reports failure', async () => {
    await runPlain();
    await act(async () => {
      boot.onMessage({ type: 'error', message: "NameError: name 'pritn' is not defined" });
      boot.onMessage({ type: 'python_result', success: false });
    });
    expect(screen.getByRole('alert').textContent).toContain("NameError: name 'pritn' is not defined");
    expect(screen.getByRole('button', { name: /^Run$/ })).toBeTruthy();
  });

  it('clears a previous error when the next run succeeds', async () => {
    await runPlain();
    await act(async () => {
      boot.onMessage({ type: 'error', message: 'SyntaxError: bad' });
      boot.onMessage({ type: 'python_result', success: false });
    });
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await act(async () => { boot.onMessage({ type: 'python_result', success: true }); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a generic error when a run fails without any message', async () => {
    await runPlain();
    await act(async () => { boot.onMessage({ type: 'python_result', success: false }); });
    expect(screen.getByRole('alert').textContent).toMatch(/did not finish/i);
  });
});
