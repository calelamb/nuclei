// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useElementSize } from './useElementSize';

let trigger: ((w: number, h: number) => void) | null = null;

class FakeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe() { trigger = (width, height) => this.cb([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
  disconnect() { trigger = null; }
  unobserve() { /* unused */ }
}

function Probe({ show }: { show: boolean }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  return <div>{show && <div ref={ref} data-testid="box" />}<span data-testid="size">{`${size.width}x${size.height}`}</span></div>;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); trigger = null; });

describe('useElementSize', () => {
  it('reports 0x0 without ResizeObserver instead of throwing', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    expect(render(<Probe show />).getByTestId('size').textContent).toBe('0x0');
  });

  it('follows resizes, rounding to whole pixels', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const { getByTestId } = render(<Probe show />);
    act(() => trigger!(812.4, 301.6));
    expect(getByTestId('size').textContent).toBe('812x302');
  });

  it('starts observing when the element mounts after the component', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const { getByTestId, rerender } = render(<Probe show={false} />);
    expect(trigger).toBeNull();
    rerender(<Probe show />);
    act(() => trigger!(640, 300));
    expect(getByTestId('size').textContent).toBe('640x300');
  });
});
