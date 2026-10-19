// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';

import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { HistogramChip } from './HistogramChip';
import { useSimulationStore } from '../../stores/simulationStore';

afterEach(() => cleanup());

describe('<HistogramChip> sample caption (IR10-08)', () => {
  afterEach(() => { delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth; useSimulationStore.setState({ result: null }); });
  it('says the chart is the Nuclei sample, with its shot count, in the stacked header', () => {
    useSimulationStore.setState({
      result: { state_vector: [], probabilities: {}, measurements: {}, bloch_coords: [], execution_time_ms: 1, shot_count: 1024 } as never,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 300; } });
    const { container } = render(<HistogramChip probabilities={{ '0': 0.5, '1': 0.5 }} />);
    const caption = container.querySelector('[data-testid="histogram-chip-sample"]');
    expect(caption?.textContent).toContain('Nuclei sample · 1,024 shots');
    // The caption is plain text; the explainer is one real button outside the ellipsised span.
    expect(caption?.getAttribute('tabindex')).toBeNull();
    expect(caption?.getAttribute('role')).toBeNull();
    expect(container.querySelector('button[aria-label="About the Nuclei sample"]')).not.toBeNull();
  });

  it('splits the caption so the name can ellipsise while the shot count stays whole, with the info button beside it', () => {
    useSimulationStore.setState({
      result: { state_vector: [], probabilities: {}, measurements: {}, bloch_coords: [], execution_time_ms: 1, shot_count: 1024 } as never,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 300; } });
    const { container } = render(<HistogramChip probabilities={{ '0': 0.5, '1': 0.5 }} />);
    const caption = container.querySelector('[data-testid="histogram-chip-sample"]') as HTMLElement;
    expect(caption.querySelector('.histogram-chip__caption-name')?.textContent).toBe('Nuclei sample');
    expect(caption.querySelector('.histogram-chip__caption-shots')?.textContent).toBe(' · 1,024 shots');
    // The separator space must survive: the shots span keeps its leading space instead of collapsing it.
    expect(caption.textContent).toContain('Nuclei sample · ');
    expect(caption.querySelector('.histogram-chip__caption-shots')?.className).toContain('histogram-chip__caption-shots');
    expect(caption.nextElementSibling?.querySelector('button[aria-label="About the Nuclei sample"]')
      ?? caption.nextElementSibling).not.toBeNull();
    expect(caption.parentElement?.querySelectorAll('button[aria-label="About the Nuclei sample"]')).toHaveLength(1);
  });
});

describe('<HistogramChip> caption affordances', () => {
  afterEach(() => { delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth; useSimulationStore.setState({ result: null }); });
  it('has no native title on the caption and the info button carries only the tooltip', () => {
    useSimulationStore.setState({
      result: { state_vector: [], probabilities: {}, measurements: {}, bloch_coords: [], execution_time_ms: 1, shot_count: 1024 } as never,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 300; } });
    const { container } = render(<HistogramChip probabilities={{ '0': 0.5, '1': 0.5 }} />);
    expect(container.querySelector('[data-testid="histogram-chip-sample"]')?.getAttribute('title')).toBeNull();
    expect(container.querySelector('button[aria-label="About the Nuclei sample"]')?.getAttribute('title')).toBeNull();
  });

  it('keeps +N more out of the caption header when stacked so the name never ellipsises', () => {
    useSimulationStore.setState({
      result: { state_vector: [], probabilities: {}, measurements: {}, bloch_coords: [], execution_time_ms: 1, shot_count: 1024 } as never,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 300; } });
    const probs = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i.toString(2).padStart(3, '0'), 0.125]));
    const { container } = render(<HistogramChip probabilities={probs} onExpand={() => {}} />);
    const caption = container.querySelector('[data-testid="histogram-chip-sample"]') as HTMLElement;
    expect(caption.parentElement?.querySelector('.histogram-chip__more')).toBeNull();
    expect(container.querySelector('.histogram-chip__more')?.textContent).toBe('+5 more');
  });
});

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

describe('<HistogramChip> keyboard tooltips (IR10-08 review)', () => {
  afterEach(() => { delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth; useSimulationStore.setState({ result: null }); });
  const withShots = () => useSimulationStore.setState({
    result: { state_vector: [], probabilities: {}, measurements: {}, bloch_coords: [], execution_time_ms: 1, shot_count: 1024 } as never,
  });

  it.each([[300, 'rows'], [900, 'inline']])('focusing Expand shows its own label, not the sample explainer (%i px, %s)', async (width) => {
    withShots();
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return width; } });
    const { getByLabelText } = render(<HistogramChip probabilities={{ '0': 0.5, '1': 0.5 }} onExpand={() => {}} onDismiss={() => {}} />);
    const expand = getByLabelText('Expand histogram');
    act(() => { expand.focus(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    const tips = document.querySelectorAll('[role="tooltip"]');
    expect(tips).toHaveLength(1);
    expect(tips[0].textContent).toBe('Expand histogram');
    expect(expand.getAttribute('aria-describedby')).toBe(tips[0].id);
  });

  it.each([[300], [900]])('offers the sample explainer on its own focusable trigger (%i px)', async (width) => {
    withShots();
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return width; } });
    const { getByLabelText } = render(<HistogramChip probabilities={{ '0': 0.5, '1': 0.5 }} />);
    const info = getByLabelText('About the Nuclei sample');
    act(() => { info.focus(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Nuclei sample · 1,024 shots');
  });
});
