// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { Tooltip, TOOLTIP_OPEN_DELAY_MS, TOOLTIP_CLOSE_DELAY_MS } from './Tooltip';
import { closeActiveTooltip, resetTooltipSingleton, TOOLTIP_WARMUP_MS } from './tooltipSingleton';
import { anchorTooltip, nudgeIntoView } from './tooltipPlacement';

beforeEach(() => { vi.useFakeTimers(); resetTooltipSingleton(); });
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

describe('one tooltip at a time', () => {
  const pair = () => render(
    <>
      <Tooltip label="Explorer"><button>one</button></Tooltip>
      <Tooltip label="Challenges"><button>two</button></Tooltip>
    </>,
  );

  it('closes the hover tooltip when keyboard focus opens another (never two on screen)', () => {
    pair();
    fireEvent.mouseEnter(screen.getByText('two'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    fireEvent.focus(screen.getByText('one'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    const tips = screen.getAllByRole('tooltip');
    expect(tips).toHaveLength(1);
    expect(tips[0].textContent).toContain('Explorer');
  });

  it('opens the neighbour straight away while moving along a row of triggers', () => {
    pair();
    fireEvent.mouseEnter(screen.getByText('one'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    fireEvent.mouseLeave(screen.getByText('one'));
    fireEvent.mouseEnter(screen.getByText('two'));
    act(() => { vi.advanceTimersByTime(20); });
    expect(screen.getAllByRole('tooltip').map((t) => t.textContent)).toEqual(['Challenges']);
  });

  it('waits the full delay again once the pointer has been away longer than the warm-up window', () => {
    pair();
    fireEvent.mouseEnter(screen.getByText('one'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    fireEvent.mouseLeave(screen.getByText('one'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_CLOSE_DELAY_MS + 10); });
    act(() => { vi.advanceTimersByTime(TOOLTIP_WARMUP_MS + 50); });
    fireEvent.mouseEnter(screen.getByText('two'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS - 50); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('side placement on a tall trigger', () => {
  const VIEW = { width: 900, height: 700 };
  const tall = { left: 860, right: 888, top: 24, bottom: 676 };

  it('anchors a left tooltip beside the pointer, not at the far edge of a full-height rail tab', () => {
    const pos = anchorTooltip(tall, 'left', VIEW, 100);
    expect(pos).toEqual({ left: 860 - 6, top: 100, placement: 'left' });
  });

  it('centres on the trigger when there is no pointer (keyboard focus)', () => {
    expect(anchorTooltip(tall, 'left', VIEW, null).top).toBe(350);
  });

  it('keeps a left tooltip inside the viewport vertically', () => {
    expect(anchorTooltip({ ...tall, top: 0 }, 'left', VIEW, 2).top).toBeGreaterThanOrEqual(8 + 14);
    expect(anchorTooltip(tall, 'left', VIEW, 699).top).toBeLessThanOrEqual(700 - 8 - 14);
  });

  it('nudges a rendered tip that overflows the bottom or right edge back inside', () => {
    expect(nudgeIntoView({ left: 800, right: 920, top: 690, bottom: 716 }, VIEW)).toEqual({ dx: -28, dy: -24 });
    expect(nudgeIntoView({ left: 2, right: 100, top: 2, bottom: 30 }, VIEW)).toEqual({ dx: 6, dy: 6 });
    expect(nudgeIntoView({ left: 100, right: 200, top: 100, bottom: 130 }, VIEW)).toEqual({ dx: 0, dy: 0 });
  });

  it('renders a left tooltip with the matching transform', () => {
    render(<Tooltip label="Open Dirac" placement="left"><button>rail</button></Tooltip>);
    fireEvent.mouseEnter(screen.getByText('rail'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.getByRole('tooltip').style.transform).toBe('translate(-100%, -50%)');
  });

  it('a modal taking focus closes a tooltip that is already showing (shell-r9-03)', () => {
    render(<Tooltip label="Switch workspace mode"><button>mode</button></Tooltip>);
    const btn = screen.getByText('mode');
    fireEvent.mouseEnter(btn);
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    act(() => { closeActiveTooltip(); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('a blur before React re-renders still cancels the open tip', () => {
    render(<Tooltip label="Switch workspace mode"><button>mode</button></Tooltip>);
    const btn = screen.getByText('mode');
    act(() => {
      fireEvent.mouseEnter(btn);
      vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10);
      fireEvent.blur(btn);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not open for a trigger the pointer already left when the warm timer fires', () => {
    render(<Tooltip label="Switch workspace mode"><button>mode</button></Tooltip>);
    const btn = screen.getByText('mode');
    fireEvent.mouseEnter(btn);
    fireEvent.mouseLeave(btn);
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('Tooltip trigger that becomes disabled', () => {
  it('closes an open focus tooltip when its trigger turns disabled', async () => {
    const view = render(<Tooltip label="New conversation"><button>new</button></Tooltip>);
    fireEvent.focus(screen.getByText('new'));
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.getByRole('tooltip')).toBeTruthy();
    view.rerender(<Tooltip label="Nothing to clear yet"><button disabled>new</button></Tooltip>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
