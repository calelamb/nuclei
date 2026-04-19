// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { HistogramChip } from './HistogramChip';

afterEach(() => cleanup());

describe('<HistogramChip>', () => {
  it('renders nothing when probabilities is null', () => {
    const { container } = render(<HistogramChip probabilities={null} />);
    expect(container.firstElementChild).toBeNull();
  });

  it('renders up to 3 bars, sorted by probability descending', () => {
    const { getAllByTestId } = render(
      <HistogramChip
        probabilities={{ '00': 0.5, '11': 0.5, '01': 0.001, '10': 0.001 }}
      />,
    );
    const bars = getAllByTestId('histogram-chip-bar');
    expect(bars).toHaveLength(3);
    expect(bars[0].textContent).toContain('|00⟩');
    expect(bars[0].textContent).toContain('50');
  });

  it('shows a dismiss button when onDismiss is provided', () => {
    const { getByLabelText } = render(
      <HistogramChip probabilities={{ '00': 1.0 }} onDismiss={() => {}} />,
    );
    expect(getByLabelText('Dismiss histogram')).not.toBeNull();
  });

  it('shows an expand button when onExpand is provided', () => {
    const { getByLabelText } = render(
      <HistogramChip probabilities={{ '00': 1.0 }} onExpand={() => {}} />,
    );
    expect(getByLabelText('Expand histogram')).not.toBeNull();
  });

  it('drops states below the epsilon threshold (1e-6)', () => {
    const { queryByText } = render(
      <HistogramChip probabilities={{ '00': 0.999999, '11': 0.0000001 }} />,
    );
    expect(queryByText(/\|11⟩/)).toBeNull();
  });
});
