// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { ProbabilityBars } from './ProbabilityBars';

afterEach(cleanup);

describe('ProbabilityBars', () => {
  it('orders outcomes by probability and drops negligible ones', () => {
    render(<ProbabilityBars probabilities={{ '00': 0.25, '11': 0.75, '01': 0.0001 }} />);
    const rows = screen.getAllByRole('listitem').map((r) => r.textContent);
    expect(rows).toEqual(['|11⟩75.0%', '|00⟩25.0%']);
  });

  it('renders nothing when every outcome is negligible', () => {
    const { container } = render(<ProbabilityBars probabilities={{ '0': 0 }} />);
    expect(container.firstChild).toBeNull();
  });
});
