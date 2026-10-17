import { describe, expect, it } from 'vitest';
import { getKernelStatusModel } from './kernelStatusModel';

const base = {
  kernelStatus: 'idle' as const, kernelReady: false, kernelError: null,
  kernelProgress: null, isRunning: false, executionTimeMs: null, isWeb: true,
};

describe('getKernelStatusModel', () => {
  it('never says ready while Python is loading', () => {
    const model = getKernelStatusModel({
      ...base, kernelStatus: 'connecting',
      kernelProgress: { step: 1, total: 3, label: 'Downloading Python', fraction: 0 },
    });
    expect(model).toMatchObject({ label: 'Downloading Python…', tone: 'busy' });
  });

  it('uses platform wording before any stage is reported', () => {
    expect(getKernelStatusModel({ ...base, kernelStatus: 'connecting' }).label).toBe('Loading Python…');
    expect(getKernelStatusModel({ ...base, kernelStatus: 'connecting', isWeb: false }).label).toBe('Starting kernel…');
  });

  it('reports a failure with the error in the detail', () => {
    const model = getKernelStatusModel({
      ...base, isWeb: false, kernelStatus: 'failed', kernelError: 'Port 8742 is already in use',
    });
    expect(model.tone).toBe('error');
    expect(model.label).toBe('Kernel failed');
    expect(model.detail).toContain('Port 8742 is already in use');
  });

  it('walks ready -> running -> done', () => {
    const ready = { ...base, kernelStatus: 'ready' as const, kernelReady: true };
    expect(getKernelStatusModel(ready)).toMatchObject({ label: 'Python ready', tone: 'ok' });
    expect(getKernelStatusModel({ ...ready, isRunning: true })).toMatchObject({ label: 'Running…', tone: 'running' });
    expect(getKernelStatusModel({ ...ready, executionTimeMs: 12.4 })).toMatchObject({ label: 'Done · 12 ms' });
  });

  it('is idle before the kernel has started', () => {
    expect(getKernelStatusModel({ ...base, isWeb: false })).toMatchObject({ label: 'Kernel idle', tone: 'idle' });
  });
});
