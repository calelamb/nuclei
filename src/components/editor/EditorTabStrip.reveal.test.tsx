// @vitest-environment jsdom
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { EditorTabStrip } from './EditorTabStrip';
import { useProjectStore } from '../../stores/projectStore';

let resizeCallbacks: Array<() => void> = [];

beforeEach(() => {
  resizeCallbacks = [];
  class FakeResizeObserver {
    constructor(cb: () => void) { resizeCallbacks.push(cb); }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  useProjectStore.setState({
    tabs: [
      { path: 'a.py', isDirty: false },
      { path: 'b.py', isDirty: false },
    ] as never,
    activeTabPath: 'b.py',
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('active tab stays in view when the strip narrows (IR10-02)', () => {
  it('scrolls the active tab into view when the strip is resized', () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement) {
      scrolled.push(this.dataset.tabPath ?? '');
    };
    render(<EditorTabStrip stripRef={createRef<HTMLDivElement>()} onMeasure={() => {}} onOverflowing={() => {}} />);
    scrolled.length = 0;
    act(() => { resizeCallbacks.forEach((cb) => cb()); });
    expect(scrolled).toContain('b.py');
  });
});
