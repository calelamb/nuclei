// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { ProbabilityBars } from './ProbabilityBars';

afterEach(cleanup);

describe('ProbabilityBars', () => {
  it('orders outcomes by basis state and drops negligible ones', () => {
    render(<ProbabilityBars probabilities={{ '11': 0.75, '00': 0.25, '01': 0.0001 }} />);
    const rows = screen.getAllByRole('listitem').map((r) => r.textContent);
    expect(rows).toEqual(['|00⟩25.0%', '|11⟩75.0%']);
  });

  it('keeps the same order whichever outcome is more likely, so sampled runs compare', () => {
    const order = () => screen.getAllByRole('listitem').map((el) => el.textContent?.slice(0, 3));
    const { rerender } = render(<ProbabilityBars probabilities={{ '1': 0.52, '0': 0.48 }} />);
    expect(order()).toEqual(['|0⟩', '|1⟩']);
    rerender(<ProbabilityBars probabilities={{ '0': 0.52, '1': 0.48 }} />);
    expect(order()).toEqual(['|0⟩', '|1⟩']);
  });

  it('renders nothing when every outcome is negligible', () => {
    const { container } = render(<ProbabilityBars probabilities={{ '0': 0 }} />);
    expect(container.firstChild).toBeNull();
  });

  it('draws pinned outcomes as empty rows even at 0%', () => {
    render(<ProbabilityBars probabilities={{ '1': 1 }} pinned={['0', '1']} />);
    expect(screen.getAllByRole('listitem').map((r) => r.textContent)).toEqual(['|0⟩0.0%', '|1⟩100.0%']);
  });
});
