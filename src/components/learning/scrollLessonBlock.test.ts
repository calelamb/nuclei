// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { scrollLessonBlock } from './scrollLessonBlock';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

function mount() {
  document.body.innerHTML = '<div class="lesson__scroll"><div id="block-2"></div></div>';
  const scroller = document.querySelector('.lesson__scroll') as HTMLElement;
  const block = document.getElementById('block-2') as HTMLElement;
  scroller.scrollTo = vi.fn();
  block.scrollIntoView = vi.fn();
  scroller.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
  block.getBoundingClientRect = () => ({ top: 400 } as DOMRect);
  scroller.scrollTop = 50;
  return { scroller, block };
}

describe('scrollLessonBlock', () => {
  it('scrolls only the lesson scroller, never an ancestor (r8-01)', () => {
    const { scroller, block } = mount();
    scrollLessonBlock(2, 'smooth');
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 350, behavior: 'smooth' });
    expect(block.scrollIntoView).not.toHaveBeenCalled();
  });

  it('does nothing for a missing block', () => {
    const { scroller } = mount();
    scrollLessonBlock(9, 'auto');
    expect(scroller.scrollTo).not.toHaveBeenCalled();
  });
});
