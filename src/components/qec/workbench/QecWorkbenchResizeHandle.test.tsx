// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QecWorkbenchResizeHandle } from './QecWorkbenchResizeHandle';

afterEach(cleanup);

describe('<QecWorkbenchResizeHandle />', () => {
  it('exposes separator values and bounded keyboard sizing', () => {
    const onChange = vi.fn();
    render(
      <QecWorkbenchResizeHandle
        label="Resize sources panel"
        orientation="vertical"
        value={280}
        min={220}
        max={480}
        direction={1}
        onChange={onChange}
      />,
    );
    const separator = screen.getByRole('separator', { name: 'Resize sources panel' });
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('aria-valuemin')).toBe('220');
    expect(separator.getAttribute('aria-valuemax')).toBe('480');
    expect(separator.getAttribute('aria-valuenow')).toBe('280');

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    fireEvent.keyDown(separator, { key: 'Home' });
    fireEvent.keyDown(separator, { key: 'End' });
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([296, 220, 480]);
  });

  it('uses reverse growth for an upper tray edge and clamps pointer movement', () => {
    const onChange = vi.fn();
    render(
      <QecWorkbenchResizeHandle
        label="Resize jobs tray"
        orientation="horizontal"
        value={260}
        min={160}
        max={520}
        direction={-1}
        onChange={onChange}
      />,
    );
    const separator = screen.getByRole('separator', { name: 'Resize jobs tray' });
    fireEvent.keyDown(separator, { key: 'ArrowUp' });
    fireEvent.mouseDown(separator, { clientY: 300 });
    fireEvent.mouseMove(window, { clientY: -100 });
    fireEvent.mouseUp(window);

    expect(onChange).toHaveBeenNthCalledWith(1, 276);
    expect(onChange).toHaveBeenLastCalledWith(520);
  });
});
