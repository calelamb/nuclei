import { describe, expect, it } from 'vitest';
import { applyMotionPreference } from './motionPreference';

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    root: {
      setAttribute: (k: string, v: string) => { attrs.set(k, v); },
      removeAttribute: (k: string) => { attrs.delete(k); },
    },
  };
}

describe('applyMotionPreference', () => {
  it('sets data-reduced-motion when animations are off', () => {
    const { root, attrs } = fakeRoot();
    applyMotionPreference(false, root);
    expect(attrs.get('data-reduced-motion')).toBe('true');
  });

  it('removes the flag when animations are on', () => {
    const { root, attrs } = fakeRoot();
    applyMotionPreference(false, root);
    applyMotionPreference(true, root);
    expect(attrs.has('data-reduced-motion')).toBe(false);
  });

  it('is a no-op without a document', () => {
    expect(() => applyMotionPreference(false, null)).not.toThrow();
  });
});
