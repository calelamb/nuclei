// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { QecAnalysisView } from './QecAnalysisView';
import { canStackLambda, isShortAnalysis, SHORT_ANALYSIS_HEIGHT } from '../../lib/qecAnalysisLayout';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';

const size = vi.hoisted(() => ({ current: { width: 700, height: 420 } }));
vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => true }));
vi.mock('../../hooks/useElementSize', () => ({ useElementSize: () => [() => undefined, size.current] }));

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';
const line = (id: string, meta: Record<string, unknown>, errors: number) =>
  `100000,${errors},0,1,pymatching,${id},"${JSON.stringify(meta).replace(/"/g, '""')}",`;
const csv = [HEADER, ...[3, 5, 7].flatMap((d) => [0.001, 0.002, 0.004].map((p, i) => line(`${d}-${i}`, { d, p, r: d }, Math.round(2000 / d ** 2))))].join('\n');

beforeEach(() => { useQecCampaignStore.getState().reset(); useQecCampaignStore.getState().loadFromCsv(csv, 'tabs.csv'); });
afterEach(() => { cleanup(); size.current = { width: 700, height: 420 }; });

describe('isShortAnalysis', () => {
  it('is short only when measured and below the threshold', () => {
    expect(isShortAnalysis(0)).toBe(false);
    expect(isShortAnalysis(SHORT_ANALYSIS_HEIGHT - 1)).toBe(true);
    expect(isShortAnalysis(SHORT_ANALYSIS_HEIGHT)).toBe(false);
  });

  it('is also tabbed when the plot cannot sit beside the readout (stack layout, q-08)', () => {
    expect(isShortAnalysis(900, 779)).toBe(true);
    expect(isShortAnalysis(900, 780)).toBe(false);
    expect(isShortAnalysis(900, 0)).toBe(false);
  });
});

describe('canStackLambda (qec-r-24)', () => {
  it('stacks the readout under the plot only in a narrow card with 260px to spare', () => {
    expect(canStackLambda(900, 470)).toBe(true);
    expect(canStackLambda(560, 470)).toBe(false);
    expect(canStackLambda(900, 1000)).toBe(false);
    expect(canStackLambda(0, 470)).toBe(false);
  });
});

describe('a tall narrow card shows Λ under the plot instead of behind a tab (qec-r-24)', () => {
  it('offers Plot | Decoders and keeps the Λ readout on the plot view', () => {
    size.current = { width: 470, height: 900 };
    const { getByRole, getByLabelText, queryByRole } = render(<QecAnalysisView embedded />);
    expect(getByRole('tab', { name: 'Plot' })).toBeTruthy();
    expect(queryByRole('tab', { name: 'Λ fit' })).toBeNull();
    expect(getByLabelText('Error suppression factor Λ')).toBeTruthy();
  });
});

describe('short windows show one analysis section at a time (qec-09)', () => {
  it('offers Plot | Λ | Decoders and starts on the plot at full height', () => {
    const { getByRole, queryByLabelText } = render(<QecAnalysisView embedded />);
    expect(getByRole('tablist', { name: 'Analysis section' })).toBeTruthy();
    expect(getByRole('group', { name: /Plot points/ })).toBeTruthy();
    expect(queryByLabelText('Error suppression factor Λ')).toBeNull();
    expect(queryByLabelText('Decoder comparison')).toBeNull();
  });

  it('switches to the Λ readout and to the decoder table', () => {
    const { getByRole, queryByRole, getByLabelText } = render(<QecAnalysisView embedded />);
    fireEvent.click(getByRole('tab', { name: 'Λ fit' }));
    expect(getByLabelText('Error suppression factor Λ')).toBeTruthy();
    expect(queryByRole('group', { name: /Plot points/ })).toBeNull();
    fireEvent.click(getByRole('tab', { name: 'Decoders' }));
    expect(getByRole('table', { name: 'Decoder comparison' })).toBeTruthy();
  });

  it('does not repeat the Λ title inside the readout when the tab header already carries it', () => {
    const { getByRole, getByLabelText } = render(<QecAnalysisView embedded />);
    fireEvent.click(getByRole('tab', { name: 'Λ fit' }));
    expect(getByLabelText('Error suppression factor Λ').querySelector('h3')).toBeNull();
  });

  it('keeps the tabs on a tall but narrow pane instead of a nested scroll (qec-r-10)', () => {
    size.current = { width: 600, height: 900 };
    const { getByRole } = render(<QecAnalysisView embedded />);
    expect(getByRole('tablist', { name: 'Analysis section' })).toBeTruthy();
  });

  it('shows everything at once when the window is tall and wide', () => {
    size.current = { width: 900, height: 900 };
    const { queryByRole, getByRole, getByLabelText } = render(<QecAnalysisView embedded />);
    expect(queryByRole('tablist', { name: 'Analysis section' })).toBeNull();
    expect(getByRole('group', { name: /Plot points/ })).toBeTruthy();
    expect(getByLabelText('Error suppression factor Λ')).toBeTruthy();
    expect(getByRole('table', { name: 'Decoder comparison' })).toBeTruthy();
  });
});

describe('one units control in the analysis (rq-r3-16)', () => {
  it('shows Per shot / Per round once when the plot and decoder table are visible together', () => {
    size.current = { width: 1000, height: 900 };
    const { container, getAllByRole } = render(<QecAnalysisView embedded />);
    expect(getAllByRole('radio', { name: /Per shot/ })).toHaveLength(1);
    expect(container.querySelector('[aria-label="Decoder comparison"]')).not.toBeNull();
  });

  it('keeps the control on the Decoders tab, where the plot header is not visible', () => {
    const { getByRole, getAllByRole } = render(<QecAnalysisView embedded />);
    fireEvent.click(getByRole('tab', { name: 'Decoders' }));
    expect(getAllByRole('radio', { name: /Per shot/ })).toHaveLength(1);
  });
});
