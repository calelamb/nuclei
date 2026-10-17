import { describe, expect, it } from 'vitest';
import { getRunButtonState } from './runButtonState';

const base = { kernelReady: false, kernelStatus: 'idle' as const, kernelProgress: null, kernelError: null, isRunning: false };

describe('getRunButtonState', () => {
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
    expect(state).toMatchObject({ kind: 'loading', label: 'Loading 2/3', disabled: true });
    expect(state.title).toBe('Loading NumPy (step 2 of 3)');
  });

  it('falls back to a plain label before the first stage is reported', () => {
    expect(getRunButtonState({ ...base, kernelStatus: 'connecting' }).label).toBe('Starting…');
  });

  it('turns into an enabled Retry action when the kernel failed', () => {
    const state = getRunButtonState({ ...base, kernelStatus: 'failed', kernelError: 'Port 8742 is already in use' });
    expect(state).toMatchObject({ kind: 'failed', label: 'Kernel failed · Retry', disabled: false });
    expect(state.title).toContain('Port 8742 is already in use');
  });

  it('prefers Running over everything else', () => {
    expect(getRunButtonState({ ...base, kernelReady: true, isRunning: true }).kind).toBe('running');
  });
});
