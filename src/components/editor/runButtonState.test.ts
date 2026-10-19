import { describe, expect, it } from 'vitest';
import { getRunButtonState, isAccidentalStop, STOP_GRACE_MS } from './runButtonState';

const base = { kernelReady: false, kernelStatus: 'idle' as const, kernelProgress: null, kernelError: null, isRunning: false };

describe('getRunButtonState', () => {
  it('names a lazy package install in the Run slot instead of Stop, and keeps it stoppable', () => {
    const state = getRunButtonState({ ...base, kernelReady: true, kernelStatus: 'ready', isRunning: true, canStop: true, installing: 'Cirq' });
    expect(state).toMatchObject({ kind: 'running', label: 'Installing Cirq…', stoppable: true });
    expect(state.title).toMatch(/one-time download.*Click to stop/);
    const plain = getRunButtonState({ ...base, kernelReady: true, kernelStatus: 'ready', isRunning: true, installing: 'Cirq' });
    expect(plain).toMatchObject({ label: 'Installing Cirq…', disabled: true });
  });

  it('is Run when the kernel is ready', () => {
    expect(getRunButtonState({ ...base, kernelReady: true, kernelStatus: 'ready' })).toMatchObject({
      kind: 'ready', label: 'Run', disabled: false,
    });
  });

  it('shows the step count while loading and the stage name in the tooltip', () => {
    const state = getRunButtonState({
      ...base,
      kernelStatus: 'connecting',
      kernelProgress: { step: 2, total: 3, label: 'Loading NumPy', fraction: 0.6 },
    });
    expect(state).toMatchObject({ kind: 'loading', label: 'Starting 2/3', queueable: true });
    expect(state.title).toBe('Loading NumPy (step 2 of 3). Click to run as soon as Python is ready.');
  });

  it('is clickable while loading: a press queues the run instead of being swallowed', () => {
    const state = getRunButtonState({
      ...base,
      kernelStatus: 'connecting',
      kernelProgress: { step: 1, total: 3, label: 'Loading Python', fraction: 0.2 },
    });
    expect(state).toMatchObject({ kind: 'loading', disabled: false, queueable: true, queued: false });
    expect(state.title).toContain('Click to run as soon as Python is ready');
  });

  it('once queued, the slot says Queued with the step and a second click cancels', () => {
    const state = getRunButtonState({
      ...base,
      kernelStatus: 'connecting',
      kernelProgress: { step: 2, total: 3, label: 'Loading NumPy', fraction: 0.6 },
      runQueued: true,
    });
    expect(state).toMatchObject({ kind: 'loading', label: 'Queued · 2/3', disabled: false, queued: true });
    expect(state.title).toBe('Runs as soon as Python is ready. Click to cancel.');
  });

  it('queued without a step count (desktop connect attempts, or before the first stage) carries no number', () => {
    const attempts = getRunButtonState({
      ...base, kernelStatus: 'connecting', runQueued: true,
      kernelProgress: { step: 2, total: 15, kind: 'attempts', label: 'Starting kernel', fraction: 0.13 },
    });
    expect(attempts.label).toBe('Queued');
    expect(getRunButtonState({ ...base, kernelStatus: 'connecting', runQueued: true }).label).toBe('Queued');
  });

  it('a failed kernel stays a disabled neutral status even if a stale queue flag lingers', () => {
    expect(getRunButtonState({ ...base, kernelStatus: 'failed', runQueued: true })).toMatchObject({ kind: 'failed', disabled: true });
  });

  it('does not show connect attempts as n/m on desktop', () => {
    const state = getRunButtonState({
      ...base,
      kernelStatus: 'connecting',
      kernelProgress: { step: 2, total: 15, kind: 'attempts', label: 'Starting kernel', fraction: 0.13 },
    });
    expect(state).toMatchObject({ kind: 'loading', label: 'Starting…', queueable: true });
    expect(state.label).not.toMatch(/\d/);
  });

  it('falls back to a plain label before the first stage is reported', () => {
    expect(getRunButtonState({ ...base, kernelStatus: 'connecting' }).label).toBe('Starting…');
  });

  it('is a neutral status when the kernel failed (the banner owns Retry)', () => {
    const state = getRunButtonState({ ...base, kernelStatus: 'failed', kernelError: 'Port 8742 is already in use' });
    expect(state).toMatchObject({ kind: 'failed', label: "Kernel didn't start", disabled: true });
    expect(state.title).toContain('Port 8742 is already in use');
  });

  it('names the engine like the status bar does on the web build', () => {
    expect(getRunButtonState({ ...base, kernelStatus: 'failed', engine: 'Python' }).label).toBe("Python didn't start");
  });

  it('becomes a Stop action while running when the runtime can interrupt', () => {
    expect(getRunButtonState({ ...base, kernelReady: true, isRunning: true, canStop: true })).toMatchObject({
      kind: 'running', label: 'Stop', disabled: false, stoppable: true,
    });
    expect(getRunButtonState({ ...base, kernelReady: true, isRunning: true })).toMatchObject({
      label: 'Running…', disabled: true,
    });
  });

  it('prefers Running over everything else', () => {
    expect(getRunButtonState({ ...base, kernelReady: true, isRunning: true }).kind).toBe('running');
  });
});

describe('isAccidentalStop', () => {
  it('ignores a Stop click inside the grace window after the run started', () => {
    expect(isAccidentalStop(1, 1000, 1000 + STOP_GRACE_MS - 1)).toBe(true);
  });
  it('allows a deliberate Stop once the grace window has passed', () => {
    expect(isAccidentalStop(1, 1000, 1000 + STOP_GRACE_MS + 1)).toBe(false);
  });
  it('ignores the second click of a double-click even outside the window', () => {
    expect(isAccidentalStop(2, 1000, 1000 + STOP_GRACE_MS * 4)).toBe(true);
  });

  it('does not double the full stop when the kernel error already ends with one', () => {
    const state = getRunButtonState({ ...base, kernelStatus: 'failed', kernelError: "Couldn't start the engine." });
    expect(state.title).toBe("Couldn't start the engine. Use Retry in the banner below.");
  });
});
