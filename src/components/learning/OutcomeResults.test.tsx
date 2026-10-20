// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { OutcomeResults } from './OutcomeResults';
import type { SimulationResult } from '../../types/quantum';

afterEach(cleanup);

const RESULT = {
  probabilities: { '0': 0.5, '1': 0.5 },
  measurements: { '0': 520, '1': 504 },
  shot_count: 1024,
} as unknown as SimulationResult;

describe('OutcomeResults (LR-04)', () => {
  it('shows sampled frequencies by default so repeated runs differ', () => {
    render(<OutcomeResults result={RESULT} />);
    expect(screen.getByText('50.8%')).toBeTruthy();
    expect(screen.getByText('49.2%')).toBeTruthy();
    expect(screen.getByText('1,024 shots')).toBeTruthy();
  });

  it('offers the ideal distribution on demand', () => {
    render(<OutcomeResults result={RESULT} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Ideal' }));
    expect(screen.getAllByText('50.0%')).toHaveLength(2);
  });

  it('falls back to ideal with no toggle when the run has no shots', () => {
    const noShots = { ...RESULT, measurements: {}, shot_count: 0 } as unknown as SimulationResult;
    render(<OutcomeResults result={noShots} />);
    expect(screen.queryByRole('radio', { name: 'Sampled' })).toBeNull();
    expect(screen.getAllByText('50.0%')).toHaveLength(2);
  });

  it('shows expected outcomes that measured 0% as empty rows', () => {
    const only1 = { probabilities: { '1': 1 }, measurements: { '1': 1024 }, shot_count: 1024 } as unknown as SimulationResult;
    render(<OutcomeResults result={only1} expectedKets={['0', '1']} />);
    expect(screen.getAllByRole('listitem').map((r) => r.textContent)).toEqual(['|0⟩0.0%', '|1⟩100.0%']);
  });
});
