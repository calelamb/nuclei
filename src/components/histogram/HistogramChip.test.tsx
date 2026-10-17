// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
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

  it('says how many outcomes are not shown and lets you open them all', () => {
    const probs: Record<string, number> = {};
    for (let i = 0; i < 64; i += 1) probs[i.toString(2).padStart(6, '0')] = 1 / 64;
    let expanded = 0;
    const { getByRole, getAllByTestId } = render(
      <HistogramChip probabilities={probs} onExpand={() => { expanded += 1; }} />,
    );
    expect(getAllByTestId('histogram-chip-bar')).toHaveLength(3);
    const more = getByRole('button', { name: /61 more outcomes/i });
    expect(more.textContent).toBe('+61 more');
    fireEvent.click(more);
    expect(expanded).toBe(1);
  });

  it('still reports hidden outcomes when the chip cannot expand', () => {
    const probs: Record<string, number> = {};
    for (let i = 0; i < 10; i += 1) probs[i.toString(2).padStart(4, '0')] = 0.1;
    const { getByText } = render(<HistogramChip probabilities={probs} />);
    expect(getByText('+7 more')).toBeTruthy();
  });

  it('shows no "more" affordance when everything fits', () => {
    const { queryByText } = render(<HistogramChip probabilities={{ '00': 0.5, '11': 0.5 }} onExpand={() => {}} />);
    expect(queryByText(/more/)).toBeNull();
  });

  it('colours the hardware series with the research blue, never Dirac purple', () => {
    const { container } = render(<HistogramChip probabilities={{ '00': 0.5, '11': 0.5 }} hwProbabilities={{ '00': 0.4, '11': 0.6 }} />);
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toContain('#7b2d8e');
    expect(html).not.toContain('#6b21a8');
  });

  it('stacks into rows when the chip is too narrow for ket, bar and percentage on one line', () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 300; } });
    const { container } = render(<HistogramChip probabilities={{ '000': 0.4, '001': 0.3, '111': 0.3 }} />);
    expect(container.firstElementChild?.getAttribute('data-layout')).toBe('rows');
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  });
});
