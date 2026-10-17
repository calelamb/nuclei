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
});
