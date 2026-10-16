// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
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
    const label = await findByTestId('interactive-decoder-label');
    expect(label.textContent).toBe('preview: greedy matcher, not PyMatching');
    expect(INTERACTIVE_DECODER_LABEL).toBe('preview: greedy matcher, not PyMatching');
    await waitFor(() => expect(getByText('Interactive')).toBeTruthy());
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
