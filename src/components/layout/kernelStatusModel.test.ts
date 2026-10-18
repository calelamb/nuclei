import { describe, expect, it } from 'vitest';
import { getKernelStatusModel } from './kernelStatusModel';
import { getRunButtonState } from '../editor/runButtonState';
import { BOOT_STAGES } from '../../platform/pyodide/workerProtocol';

const base = {
  kernelStatus: 'idle' as const, kernelReady: false, kernelError: null,
  kernelProgress: null, isRunning: false, executionTimeMs: null, lastRunFailed: false, isWeb: true,
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
    expect(getKernelStatusModel({ ...base, kernelStatus: 'connecting' }).label).toBe('Preparing Python…');
    expect(getKernelStatusModel({ ...base, kernelStatus: 'connecting', isWeb: false }).label).toBe('Starting kernel…');
  });

  it('reports a failure with the error in the detail', () => {
    const model = getKernelStatusModel({
      ...base, isWeb: false, kernelStatus: 'failed', kernelError: 'Port 8742 is already in use',
    });
    expect(model.tone).toBe('error');
    expect(model.label).toBe("Kernel didn't start");
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

  it('does not claim a clean finish after the last run raised an error', () => {
    const model = getKernelStatusModel({ ...base, kernelStatus: 'ready', kernelReady: true, lastRunFailed: true });
    expect(model).toMatchObject({ label: 'Last run failed', tone: 'warn' });
    expect(model.detail).toMatch(/error/i);
  });

  it('reports a finished run that defined no circuit as done, never as a failure', () => {
    const model = getKernelStatusModel({ ...base, kernelStatus: 'ready', kernelReady: true, lastRunNoCircuit: true });
    expect(model).toMatchObject({ label: 'Done · no circuit', tone: 'ok' });
    expect(model.detail).toMatch(/plain Python|no circuit/i);
  });

  it('a run in progress wins over the previous failure', () => {
    const model = getKernelStatusModel({
      ...base, kernelStatus: 'ready', kernelReady: true, lastRunFailed: true, isRunning: true,
    });
    expect(model.tone).toBe('running');
  });
});

describe('web boot vocabulary (design-r5-02)', () => {
  it('no web boot surface says kernel, whichever stage is reported', () => {
    BOOT_STAGES.forEach((stage, index) => {
      const progress = { step: index + 1, total: BOOT_STAGES.length, label: stage.label, fraction: stage.fraction };
      const bar = getKernelStatusModel({ ...base, kernelStatus: 'connecting', kernelProgress: progress });
      const slot = getRunButtonState({
        kernelReady: false, kernelStatus: 'connecting', kernelProgress: progress, kernelError: null,
        isRunning: false, engine: 'Python',
      });
      [bar.label, bar.detail, slot.label, slot.title].forEach((text) => expect(text).not.toMatch(/kernel/i));
    });
    const early = getKernelStatusModel({ ...base, kernelStatus: 'connecting' });
    expect(`${early.label} ${early.detail}`).not.toMatch(/kernel/i);
    const failed = getKernelStatusModel({ ...base, kernelStatus: 'failed' });
    expect(`${failed.label} ${failed.detail}`).not.toMatch(/kernel/i);
  });
});
