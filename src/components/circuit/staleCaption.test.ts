import { describe, expect, it } from 'vitest';
import { describeStale, PENDING_LABEL } from './staleCaption';

const quiet = { previewPaused: false, error: null, errorLine: null, previewPending: false };

describe('describeStale', () => {
  it('says Updating… for a slow preview, in the same pill shape as Out of date', () => {
    const pill = describeStale({ ...quiet, previewPending: true });
    expect(pill?.label).toBe(PENDING_LABEL);
    expect(pill?.label).toBe('Updating…');
    expect(pill?.line).toBeNull();
  });

  it('lets a real error or pause outrank a pending update', () => {
    expect(describeStale({ ...quiet, previewPending: true, errorLine: 4 })?.label).toBe('Out of date · line 4');
    expect(describeStale({ ...quiet, previewPending: true, previewPaused: true })?.label).toBe('Preview paused');
  });

  it('is null when nothing is wrong', () => {
    expect(describeStale(quiet)).toBeNull();
  });
});
