// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Tooltip, TOOLTIP_OPEN_DELAY_MS, TOOLTIP_CLOSE_DELAY_MS } from './Tooltip';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

const setup = () => render(
  <Tooltip label="Cycle UI mode" shortcut="⌘⇧L"><button>mode</button></Tooltip>,
);

describe('Tooltip', () => {
  it('opens only after the delay, not on a quick pass-over', () => {
    setup();
    fireEvent.mouseEnter(screen.getByText('mode'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS - 50); });
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => { vi.advanceTimersByTime(60); });
    expect(screen.getByRole('tooltip').textContent).toContain('Cycle UI mode');
  });

  it('shows the shortcut as a kbd chip in glyph form', () => {
    setup();
    fireEvent.mouseEnter(screen.getByText('mode'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.getByRole('tooltip').querySelector('kbd')?.textContent).toBe('⌘⇧L');
  });

  it('cancels a pending open when the pointer leaves', () => {
    setup();
    const btn = screen.getByText('mode');
    fireEvent.mouseEnter(btn);
    fireEvent.mouseLeave(btn);
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes shortly after the pointer leaves', () => {
    setup();
    const btn = screen.getByText('mode');
    fireEvent.mouseEnter(btn);
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    fireEvent.mouseLeave(btn);
    act(() => { vi.advanceTimersByTime(TOOLTIP_CLOSE_DELAY_MS + 10); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens on keyboard focus and closes on Escape', () => {
    setup();
    fireEvent.focus(screen.getByText('mode'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(screen.getByText('mode'), { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('describes the trigger for assistive tech while open', () => {
    setup();
    fireEvent.focus(screen.getByText('mode'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    const tip = screen.getByRole('tooltip');
    expect(screen.getByText('mode').getAttribute('aria-describedby')).toBe(tip.id);
  });

  it('does not re-open from the focus a mouse click causes', () => {
    setup();
    const btn = screen.getByText('mode');
    fireEvent.mouseEnter(btn);
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    fireEvent.mouseDown(btn);
    fireEvent.focus(btn);
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('places itself beside the trigger for rail icons', () => {
    render(<Tooltip label="Explorer" placement="right"><button>files</button></Tooltip>);
    fireEvent.mouseEnter(screen.getByText('files'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.getByRole('tooltip').style.transform).toBe('translate(0, -50%)');
  });

  it('does not re-open after a click until the pointer has left and re-entered', () => {
    setup();
    const btn = screen.getByText('mode');
    fireEvent.mouseEnter(btn);
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    fireEvent.mouseDown(btn);
    // The click re-renders the trigger under the cursor; the browser fires a fresh mouseenter.
    fireEvent.mouseEnter(btn);
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseLeave(btn);
    fireEvent.mouseEnter(btn);
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  describe('viewport clamping', () => {
    const realRect = Element.prototype.getBoundingClientRect;
    afterEach(() => { Element.prototype.getBoundingClientRect = realRect; });

    function mockRects(trigger: Partial<DOMRect>, tipWidth: number) {
      Element.prototype.getBoundingClientRect = function mocked(this: Element) {
        if (this.getAttribute('role') === 'tooltip') {
          const left = parseFloat((this as HTMLElement).style.left) - tipWidth / 2;
          return { left, right: left + tipWidth, width: tipWidth, top: 0, bottom: 20, height: 20, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
        }
        if (this.tagName === 'BUTTON') {
          return { top: 400, bottom: 420, height: 20, x: 0, y: 400, toJSON: () => ({}), ...trigger } as DOMRect;
        }
        return realRect.call(this);
      };
    }

    it('keeps a wide tooltip inside the right edge of the viewport', () => {
      window.innerWidth = 1000;
      mockRects({ left: 960, right: 1000, width: 40 }, 220);
      setup();
      fireEvent.mouseEnter(screen.getByText('mode'));
      act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
      const left = parseFloat(screen.getByRole('tooltip').style.left);
      expect(left + 110).toBeLessThanOrEqual(1000 - 8);
    });

    it('keeps a wide tooltip inside the left edge of the viewport', () => {
      window.innerWidth = 1000;
      mockRects({ left: 0, right: 40, width: 40 }, 220);
      setup();
      fireEvent.mouseEnter(screen.getByText('mode'));
      act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
      const left = parseFloat(screen.getByRole('tooltip').style.left);
      expect(left - 110).toBeGreaterThanOrEqual(8);
    });
  });
});
