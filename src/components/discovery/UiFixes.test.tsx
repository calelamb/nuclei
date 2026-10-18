// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { DiscoveryWorkbench } from './DiscoveryWorkbench';
import { NewDiscoveryWizard } from './NewDiscoveryWizard';
import { fixtureRun, fixtureSpec } from '../../services/discovery/fixtures';
import { bestFitnessLabel, earlyStopNotice } from '../../services/discovery/format';
import { renderOn, resetDiscoveryTestState, seedPopulated } from './testUtils';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="monaco-diff" />,
  default: () => null,
  loader: { config: () => undefined },
}));

beforeEach(() => resetDiscoveryTestState());
afterEach(() => cleanup());

const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));

describe('Promote on non-promotable candidates', () => {
  it.each([['c-0004', 'rejected'], ['c-0005', 'failed']])('%s (%s) has Promote disabled with a reason', (id) => {
    seedPopulated({ candidateId: id });
    renderOn(<DiscoveryWorkbench />);
    const button = within(screen.getByRole('dialog', { name: `Candidate ${id}` })).getByRole('button', { name: /Promote/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title.length).toBeGreaterThan(10);
  });

  it('a scored candidate can still be promoted', () => {
    seedPopulated({ candidateId: 'c-0003' });
    renderOn(<DiscoveryWorkbench />);
    expect((within(screen.getByRole('dialog', { name: 'Candidate c-0003' })).getByRole('button', { name: /Promote/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('early stop explanation', () => {
  it('shows a notice when the run ended on early_stop and the runner left no message', () => {
    seedPopulated({ run: { status: 'completed', stop_reason: 'early_stop', message: null, stale_generations: 4 } });
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByRole('region', { name: 'Run notices' }).textContent).toMatch(/Stopped early: no improvement in \d+ generations/);
  });

  it('prefers the runner message over the generated sentence', () => {
    const run = fixtureRun({ status: 'completed', stop_reason: 'early_stop', message: 'Stopped early: patience 10 reached.' });
    expect(earlyStopNotice(run)).toBe('Stopped early: patience 10 reached.');
  });

  it('says nothing for budget stops, user stops and running runs', () => {
    expect(earlyStopNotice(fixtureRun({ status: 'completed', stop_reason: 'max_evaluations', message: null }))).toBeNull();
    expect(earlyStopNotice(fixtureRun({ status: 'stopped', stop_reason: 'user', message: null }))).toBeNull();
    expect(earlyStopNotice(fixtureRun({ status: 'running', stop_reason: null, message: null }))).toBeNull();
  });
});

describe('counts agree about the seed', () => {
  it('labels the KPI outcomes as excluding the seed', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByLabelText('Evaluations breakdown').textContent).toContain('outcomes excluding the seed');
  });
});

describe('Red Queen sidebar fitness', () => {
  const fmt = (v: number) => String(v);
  it('labels adversarial fitness as a gap, or as an exploit past the bonus', () => {
    expect(bestFitnessLabel(0.4, true, fmt).text).toBe('gap 0.4');
    expect(bestFitnessLabel(1002.5, true, fmt).text).toBe('exploit');
    expect(bestFitnessLabel(3.4, false, fmt).text).toBe('3.4');
    expect(bestFitnessLabel(undefined, true, fmt).text).toBe('—');
  });
});

describe('Guardrails tab for Red Queen runs', () => {
  const rq = { spec: fixtureSpec({ mutator: { kind: 'red_queen' }, red_queen: { max_audits: 10 } }) };
  it('puts the exploits lane before rejection reasons', () => {
    seedPopulated({ run: rq });
    renderOn(<DiscoveryWorkbench />);
    openTab('Guardrails');
    const lane = screen.getByTestId('exploits-found-lane');
    const reasons = screen.getByText('Rejection reasons');
    expect(lane.compareDocumentPosition(reasons) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('keeps the lane last for standard runs', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    openTab('Guardrails');
    const lane = screen.getByTestId('exploits-found-lane');
    expect(lane.compareDocumentPosition(screen.getByText('Rejection reasons')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
  it('says "instructed", never "forbidden", and states what the sandbox blocks', () => {
    seedPopulated({ run: rq });
    renderOn(<DiscoveryWorkbench />);
    openTab('Guardrails');
    expect(screen.getAllByText(/file reads are being restricted/)[0].textContent).toMatch(/OS sandbox blocks network access and file writes/);
  });
});

describe('wizard fixes', () => {
  it('the Name placeholder follows the selected template', () => {
    renderOn(<NewDiscoveryWizard />);
    const before = (screen.getByLabelText('Name') as HTMLInputElement).placeholder;
    fireEvent.click(screen.getAllByRole('radio')[3]);
    const after = (screen.getByLabelText('Name') as HTMLInputElement).placeholder;
    expect(after).not.toBe(before);
    expect(after).toMatch(/frontier/);
  });

  it('the Mutator subtitle follows the mode and Red Queen copy is a warning that says instructed', () => {
    renderOn(<NewDiscoveryWizard />);
    expect(screen.getByText(/AlphaEvolve style/)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Red Queen (audit the evaluator)' }));
    expect(screen.queryByText(/AlphaEvolve style/)).toBeNull();
    const options = screen.getByTestId('red-queen-options');
    expect(options.textContent).toMatch(/instructed not to/);
    expect(options.textContent).not.toMatch(/forbidden/);
    expect(options.textContent).toMatch(/file reads are being restricted/);
    expect(options.querySelector('[data-tone="danger"], .lab-callout--danger')).toBeNull();
  });

  it('template cards align to the top instead of stretching', () => {
    renderOn(<NewDiscoveryWizard />);
    expect(screen.getByRole('radiogroup', { name: 'Discovery template' }).style.alignItems).toBe('start');
  });
});
