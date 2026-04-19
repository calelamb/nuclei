import { describe, it, expect, beforeEach } from 'vitest';
import { useDiracStore } from './diracStore';

describe('diracStore compose preview', () => {
  beforeEach(() => useDiracStore.setState({ composePreview: null }));

  it('starts null', () => {
    expect(useDiracStore.getState().composePreview).toBeNull();
  });

  it('setComposePreview attaches id + timestamp', () => {
    useDiracStore.getState().setComposePreview({ intent: 'bell', code: 'x', explanation: 'e' });
    const p = useDiracStore.getState().composePreview!;
    expect(p.code).toBe('x');
    expect(typeof p.id).toBe('string');
    expect(typeof p.timestamp).toBe('number');
  });

  it('clearComposePreview nulls it', () => {
    useDiracStore.getState().setComposePreview({ intent: 'bell', code: 'x', explanation: 'e' });
    useDiracStore.getState().clearComposePreview();
    expect(useDiracStore.getState().composePreview).toBeNull();
  });
});
