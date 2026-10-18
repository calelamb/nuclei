// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CodeLatticePanel } from './CodeLatticePanel';
import { useQecStore } from '../../stores/qecStore';
import { useCircuitStore } from '../../stores/circuitStore';
import fixture from './__fixtures__/surface_d3.json';

describe('CodeLatticePanel figure', () => {
  beforeEach(() => {
    useQecStore.setState({ snapshot: fixture.qec as never });
    useCircuitStore.setState({ snapshot: fixture.snapshot as never });
  });
  afterEach(cleanup);

  it('caps the figure and sizes its nodes in pixels, not viewBox units', () => {
    const { container } = render(<CodeLatticePanel embedded />);
    const figure = screen.getByTestId('lattice-figure');
    expect(figure.style.maxWidth).toBe('400px');
    const nodes = container.querySelectorAll<HTMLElement>('[data-lattice-node]');
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) expect(node.style.width).toBe('14px');
  });

  it('draws the stabilizer bonds and explains the active-this-tick mark', () => {
    const { container } = render(<CodeLatticePanel embedded />);
    expect(container.querySelectorAll('line').length).toBeGreaterThan(0);
    expect(screen.getByText(/active this tick/)).toBeTruthy();
  });
});
