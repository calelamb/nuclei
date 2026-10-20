// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Grid3x3 } from 'lucide-react';
import { QecEmptyState } from './QecEmptyState';

describe('QecEmptyState icon', () => {
  afterEach(cleanup);

  it('defaults to the chart-line icon', () => {
    const { container } = render(<QecEmptyState title="t" body="b" />);
    expect(container.querySelector('svg.lucide-chart-spline')).not.toBeNull();
  });

  it('shows the panel icon when one is given', () => {
    const { container } = render(<QecEmptyState title="t" body="b" icon={Grid3x3} />);
    expect(container.querySelector('svg.lucide-chart-spline')).toBeNull();
    expect(container.querySelector('svg.lucide-grid-3x3, svg.lucide-grid3x3')).not.toBeNull();
  });
});
