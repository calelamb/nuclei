import { describe, it, expect, beforeEach } from 'vitest';
import { useDiracStore } from './diracStore';

describe('diracStore ambient feed', () => {
  beforeEach(() => {
    useDiracStore.setState({ ambientFeed: [], rewrittenError: null });
  });

  it('starts empty', () => {
    expect(useDiracStore.getState().ambientFeed).toEqual([]);
    expect(useDiracStore.getState().rewrittenError).toBeNull();
  });

  it('pushAmbient appends with id + timestamp', () => {
    useDiracStore.getState().pushAmbient({ kind: 'parse', text: 'hello' });
    const feed = useDiracStore.getState().ambientFeed;
    expect(feed).toHaveLength(1);
    expect(feed[0].text).toBe('hello');
    expect(typeof feed[0].id).toBe('string');
    expect(typeof feed[0].timestamp).toBe('number');
  });

  it('caps the feed at 5 most recent entries', () => {
    for (let i = 0; i < 8; i++) {
      useDiracStore.getState().pushAmbient({ kind: 'parse', text: `m${i}` });
    }
    const feed = useDiracStore.getState().ambientFeed;
    expect(feed).toHaveLength(5);
    expect(feed[0].text).toBe('m3');
    expect(feed[4].text).toBe('m7');
  });

  it('setRewrittenError attaches a timestamp', () => {
    useDiracStore.getState().setRewrittenError({
      explanation: 'why',
      fix: null,
      originalTraceback: 'X',
    });
    const e = useDiracStore.getState().rewrittenError;
    expect(e?.explanation).toBe('why');
    expect(typeof e?.timestamp).toBe('number');
  });

  it('clearRewrittenError nulls it out', () => {
    useDiracStore.getState().setRewrittenError({
      explanation: 'w',
      fix: null,
      originalTraceback: 'X',
    });
    useDiracStore.getState().clearRewrittenError();
    expect(useDiracStore.getState().rewrittenError).toBeNull();
  });
});
