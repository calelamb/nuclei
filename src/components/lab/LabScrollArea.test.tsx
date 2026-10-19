// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LabScrollArea } from './LabScrollArea';
import { overflowEdges } from './scrollMath';

afterEach(cleanup);

describe('overflowEdges', () => {
  it('reports which sides still have content', () => {
    const el = { scrollLeft: 0, scrollTop: 0, scrollWidth: 800, scrollHeight: 100, clientWidth: 400, clientHeight: 100 };
    expect(overflowEdges(el)).toEqual({ left: false, right: true, top: false, bottom: false });
    expect(overflowEdges({ ...el, scrollLeft: 400 })).toEqual({ left: true, right: false, top: false, bottom: false });
    expect(overflowEdges({ ...el, scrollWidth: 400 })).toEqual({ left: false, right: false, top: false, bottom: false });
  });
});

describe('LabScrollArea', () => {
  function mockSizes(el: HTMLElement, sizes: Record<string, number>) {
    for (const [key, value] of Object.entries(sizes)) Object.defineProperty(el, key, { configurable: true, value });
  }

  it('shows no hint when nothing is clipped', () => {
    render(<LabScrollArea label="Circuit"><div>content</div></LabScrollArea>);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows a fade and a hint when content is clipped, and updates on scroll', () => {
    const { container } = render(<LabScrollArea label="Circuit"><div>wide content</div></LabScrollArea>);
    const viewport = screen.getByRole('region', { name: 'Circuit' });
    mockSizes(viewport, { scrollWidth: 900, clientWidth: 300, scrollHeight: 50, clientHeight: 50 });
    fireEvent.scroll(viewport);
    expect(container.querySelector('.lab-scroll')?.getAttribute('data-more-right')).toBe('true');
    expect(screen.getByRole('note').textContent).toBe('Scroll sideways to see the rest');
    mockSizes(viewport, { scrollLeft: 600 });
    fireEvent.scroll(viewport);
    expect(container.querySelector('.lab-scroll')?.getAttribute('data-more-right')).toBe('false');
    expect(container.querySelector('.lab-scroll')?.getAttribute('data-more-left')).toBe('true');
  });
});
