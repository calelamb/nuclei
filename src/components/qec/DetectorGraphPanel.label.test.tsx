// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import repetition from './__fixtures__/repetition_d3.json';
import { DetectorGraphPanel, INTERACTIVE_DECODER_LABEL } from './DetectorGraphPanel';
import { useQecStore } from '../../stores/qecStore';
import type { QecSnapshot } from '../../types/qec';

vi.mock('../../lib/qecDecodeSender', () => ({
  requestQecDecodeSample: vi.fn(),
  requestQecSnapshot: vi.fn(),
}));
vi.mock('../../lib/qecDecoderWasm', () => ({
  isDecoderAvailable: () => Promise.resolve(true),
  decodeSyndrome: () => Promise.resolve(null),
}));

afterEach(() => cleanup());

describe('DetectorGraphPanel interactive decoder honesty', () => {
  it('labels the interactive decoder as a greedy preview, not PyMatching', async () => {
    useQecStore.setState({ snapshot: repetition.qec as QecSnapshot, circuitText: '# stim' });
    const { findByTestId, getByText } = render(<DetectorGraphPanel />);
    await waitFor(() => expect(getByText('Interactive')).toBeTruthy());
    fireEvent.click(getByText('Interactive'));
    const label = await findByTestId('interactive-decoder-label');
    expect(label.textContent).toBe('Greedy preview');
    expect(label.getAttribute('title')).toBe('preview: greedy matcher, not PyMatching');
    expect(INTERACTIVE_DECODER_LABEL).toBe('preview: greedy matcher, not PyMatching');
  });

  it('keeps the explain panel collapsed until it has something to say (qec-10)', () => {
    useQecStore.setState({ snapshot: repetition.qec as QecSnapshot, circuitText: '# stim' });
    const { getByRole, container } = render(<DetectorGraphPanel />);
    const toggle = getByRole('button', { name: /Why does this circuit fail/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect((container.querySelector('#qec-explain-body') as HTMLElement).hidden).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('puts the legend behind a toggle so it never covers the graph', () => {
    useQecStore.setState({ snapshot: repetition.qec as QecSnapshot, circuitText: '# stim' });
    const { getByRole, queryByText } = render(<DetectorGraphPanel />);
    expect(queryByText('observable')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Legend' }));
    expect(queryByText('observable')).toBeTruthy();
  });

  it('mounts the Circuit Explain panel next to the graph', () => {
    useQecStore.setState({ snapshot: repetition.qec as QecSnapshot, circuitText: '# stim' });
    const { getByRole } = render(<DetectorGraphPanel />);
    expect(getByRole('region', { name: 'Circuit explain' })).toBeTruthy();
  });

  it('still mounts it when the DEM could not be built (the non-deterministic case)', () => {
    useQecStore.setState({
      snapshot: { ...(repetition.qec as QecSnapshot), dem: null, dem_error: 'observable is not deterministic' },
    });
    const { getByRole } = render(<DetectorGraphPanel />);
    expect(getByRole('region', { name: 'Circuit explain' })).toBeTruthy();
  });
});
