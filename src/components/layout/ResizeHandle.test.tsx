// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResizeHandle } from './ResizeHandle';

afterEach(cleanup);

describe('ResizeHandle', () => {
  it('exposes the rule orientation to assistive tech', () => {
    const { rerender } = render(<ResizeHandle direction="horizontal" isDragging={false} onMouseDown={() => {}} onDoubleClick={() => {}} />);
    expect(screen.getByRole('separator').getAttribute('aria-orientation')).toBe('vertical');
    rerender(<ResizeHandle direction="vertical" isDragging={false} onMouseDown={() => {}} onDoubleClick={() => {}} />);
    expect(screen.getByRole('separator').getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('never mutates its own layout on hover (hover is drawn by CSS)', () => {
    render(<ResizeHandle direction="horizontal" isDragging={false} onMouseDown={() => {}} onDoubleClick={() => {}} />);
    const sep = screen.getByRole('separator');
    fireEvent.mouseEnter(sep);
    fireEvent.mouseOver(sep);
    expect(sep.getAttribute('style')).toBeNull();
  });

  it('captures the pointer on press and starts the drag', () => {
    const onMouseDown = vi.fn();
    render(<ResizeHandle direction="horizontal" isDragging={false} onMouseDown={onMouseDown} onDoubleClick={() => {}} />);
    const sep = screen.getByRole('separator');
    const capture = vi.fn();
    sep.setPointerCapture = capture;
    fireEvent.pointerDown(sep, { pointerId: 7 });
    expect(capture).toHaveBeenCalledWith(7);
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });
});
