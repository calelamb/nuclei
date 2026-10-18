import { describe, expect, it } from 'vitest';
import { useRunQueueStore } from './runQueueStore';

describe('runQueueStore', () => {
  it('starts empty and toggles', () => {
    expect(useRunQueueStore.getState().queued).toBe(false);
    useRunQueueStore.getState().setQueued(true);
    expect(useRunQueueStore.getState().queued).toBe(true);
    useRunQueueStore.getState().setQueued(false);
    expect(useRunQueueStore.getState().queued).toBe(false);
  });
});
