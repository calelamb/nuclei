import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorRevealStore, clampRevealLine } from './editorRevealStore';

describe('editorRevealStore', () => {
  beforeEach(() => useEditorRevealStore.getState().clear());

  it('issues a distinct request each time, even for the same line', () => {
    useEditorRevealStore.getState().revealLine(5);
    const first = useEditorRevealStore.getState().request;
    useEditorRevealStore.getState().revealLine(5);
    const second = useEditorRevealStore.getState().request;
    expect(first?.line).toBe(5);
    expect(second?.line).toBe(5);
    expect(second?.nonce).not.toBe(first?.nonce);
  });

  it('ignores invalid lines', () => {
    useEditorRevealStore.getState().revealLine(0);
    useEditorRevealStore.getState().revealLine(1.5);
    expect(useEditorRevealStore.getState().request).toBeNull();
  });

  it('clamps into the model range', () => {
    expect(clampRevealLine(50, 10)).toBe(10);
    expect(clampRevealLine(0, 10)).toBe(1);
    expect(clampRevealLine(3, 0)).toBe(1);
    expect(clampRevealLine(4, 10)).toBe(4);
  });
});
