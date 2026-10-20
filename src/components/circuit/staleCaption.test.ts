import { describe, expect, it } from 'vitest';
import { describeStale, PENDING_LABEL } from './staleCaption';

const quiet = { previewPaused: false, error: null, errorLine: null, previewPending: false };

describe('describeStale', () => {
  it('names the framework being installed instead of a generic Updating…', () => {
    const pill = describeStale({ ...quiet, previewPending: true, installing: 'Cirq' });
    expect(pill?.label).toBe('Installing Cirq…');
  });

  it('says Updating… for a slow preview, in the same pill shape as Out of date', () => {
    const pill = describeStale({ ...quiet, previewPending: true });
    expect(pill?.label).toBe(PENDING_LABEL);
    expect(pill?.label).toBe('Updating…');
    expect(pill?.line).toBeNull();
  });

  it('lets a pending update outrank an error from older code (interaction-r-07), but not a pause', () => {
    expect(describeStale({ ...quiet, previewPending: true, errorLine: 4 })?.label).toBe('Updating…');
    expect(describeStale({ ...quiet, previewPending: true, error: 'x' })?.label).toBe('Updating…');
    expect(describeStale({ ...quiet, previewPending: true, previewPaused: true })?.label).toBe('Preview paused');
    expect(describeStale({ ...quiet, errorLine: 4 })?.label).toBe('Out of date · line 4');
  });

  it('explains the pause in a sentence and makes it actionable (interaction-r-12)', () => {
    const pill = describeStale({ ...quiet, previewPaused: true });
    expect(pill?.tooltip).toBe('This code takes longer than 5 s to preview. Press Run to run it.');
    expect(pill?.action).toBe('run');
  });

  it('is null when nothing is wrong', () => {
    expect(describeStale(quiet)).toBeNull();
  });
});
