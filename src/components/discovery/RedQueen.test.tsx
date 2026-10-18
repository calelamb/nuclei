// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DiscoveryWorkbench } from './DiscoveryWorkbench';
import { NewDiscoveryWizard } from './NewDiscoveryWizard';
import { ExploitsFoundLane } from './ExploitsFoundLane';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { FIXTURE_RUN_ID, fixtureCandidates, fixtureSpec } from '../../services/discovery/fixtures';
import { exploitsOf, summarizeAudits } from '../../services/discovery/redQueen';
import { makeAudit } from '../../services/discovery/testkit';
import type { CandidateRecord, DiscoveryAudit } from '../../types/discovery';
import { renderOn, resetDiscoveryTestState, seedPopulated, spyOnActions } from './testUtils';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="monaco-diff" />,
  default: () => null,
  loader: { config: () => undefined },
}));

beforeEach(() => resetDiscoveryTestState());
afterEach(() => cleanup());

const EXPLOIT: DiscoveryAudit = makeAudit({
  verdict: 'exploit', evaluator_fitness: 2.9, audit_fitness: 0.4, gap: 2.5, reasons: ['determinism only holds under the evaluator seed'],
  checks: [
    { id: 'reparse', label: 'Re-parse from scratch', status: 'pass', detail: null },
    { id: 'det', label: 'Deterministic under a fresh seed', status: 'fail', detail: 'observable flipped under seed 99' },
  ],
  notes: ['Audited under depolarizing noise.'],
});

function withAudit(id: string, patch: Partial<CandidateRecord>): CandidateRecord[] {
  return fixtureCandidates().map((c) => (c.id === id ? { ...c, ...patch } : c));
}

const rqRun = { spec: fixtureSpec({ mutator: { kind: 'red_queen' }, red_queen: { max_audits: 10 } }) };

describe('ExploitsFoundLane', () => {
  const exploits = exploitsOf(FIXTURE_RUN_ID, withAudit('c-0009', { audit: EXPLOIT }), rqRun.spec);

  it('lists an exploit card with verdict, gap, failed checks, candidate link and export, plus the audit summary', async () => {
    const onExport = vi.fn(async () => ({ ok: true as const, path: 'proj/kernel/tests/fixtures/exploits/x.json', inKernelFixtures: true, id: 'x' }));
    const onSelect = vi.fn();
    const summary = summarizeAudits(withAudit('c-0009', { audit: EXPLOIT }));
    renderOn(<ExploitsFoundLane exploits={exploits} summary={summary} redQueen runStatus="completed" onSelectCandidate={onSelect} onExport={onExport} />);
    const lane = screen.getByTestId('exploits-found-lane');
    expect(lane.getAttribute('data-state')).toBe('filled');
    expect(within(lane).getByText('Red Queen')).toBeTruthy();
    const summaryList = within(lane).getByLabelText('Audit summary');
    expect(summaryList.textContent).toContain('Audits run1');
    expect(summaryList.textContent).toContain('Exploits1');
    const card = within(lane).getByRole('listitem', { name: 'Exploit c-0009' });
    expect(within(card).getByText('Exploit')).toBeTruthy();
    expect(within(card).getByLabelText('Exploit scores').textContent).toContain('2.5');
    const failed = within(card).getByRole('list', { name: 'Failed audit checks' });
    expect(failed.textContent).toContain('Deterministic under a fresh seed');
    expect(failed.textContent).not.toContain('Re-parse from scratch');
    fireEvent.click(within(card).getByRole('button', { name: 'Open candidate c-0009' }));
    expect(onSelect).toHaveBeenCalledWith('c-0009');
    fireEvent.click(within(card).getByRole('button', { name: 'Export as regression fixture' }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith('c-0009'));
    expect(await within(card).findByText(/Wrote proj\/kernel\/tests\/fixtures\/exploits\/x\.json/)).toBeTruthy();
  });

  it('says where an export went when the kernel fixtures folder is missing, and shows errors', async () => {
    const onExport = vi.fn()
      .mockResolvedValueOnce({ ok: true, path: 'proj/run/exploits/x.json', inKernelFixtures: false, id: 'x' })
      .mockResolvedValueOnce({ ok: false, error: 'disk full' });
    renderOn(<ExploitsFoundLane exploits={exploits} redQueen onExport={onExport} />);
    const button = screen.getByRole('button', { name: 'Export as regression fixture' });
    fireEvent.click(button);
    expect(await screen.findByText(/stayed with the run/)).toBeTruthy();
    fireEvent.click(button);
    expect(await screen.findByText('disk full')).toBeTruthy();
  });

  it('empty, Red Queen run that finished: the honest "no exploit found within budget" state', () => {
    renderOn(<ExploitsFoundLane redQueen runStatus="completed" summary={{ run: 4, pending: 0, consistent: 4, inconclusive: 0, exploits: 0, errors: 0, maxGap: 0 }} />);
    const lane = screen.getByTestId('exploits-found-lane');
    expect(lane.getAttribute('data-state')).toBe('empty');
    expect(lane.textContent).toContain('No exploit found within budget');
    expect(lane.textContent).toContain('Evidence, not proof, of robustness');
    expect(lane.textContent).toContain('4 audits');
  });

  it('empty, Red Queen run still going: no claim about robustness yet', () => {
    renderOn(<ExploitsFoundLane redQueen runStatus="running" />);
    const lane = screen.getByTestId('exploits-found-lane');
    expect(lane.textContent).toContain('No exploit yet');
    expect(lane.textContent).not.toContain('within budget');
  });

  it('empty, standard run: points at Red Queen mode and manual audits', () => {
    renderOn(<ExploitsFoundLane runStatus="completed" />);
    const lane = screen.getByTestId('exploits-found-lane');
    expect(lane.getAttribute('data-state')).toBe('empty');
    expect(lane.textContent).toContain('No exploits recorded');
    expect(lane.textContent).toContain('Standard run');
  });
});

describe('Guardrails tab wiring', () => {
  it('fills the lane from the run, and exports through the store', async () => {
    seedPopulated({ run: rqRun, candidates: withAudit('c-0009', { audit: EXPLOIT }) });
    const spies = spyOnActions(['exportExploitFixture']);
    renderOn(<DiscoveryWorkbench />);
    fireEvent.click(screen.getByRole('tab', { name: /^Guardrails/ }));
    const lane = screen.getByTestId('exploits-found-lane');
    expect(lane.getAttribute('data-state')).toBe('filled');
    fireEvent.click(within(lane).getByRole('button', { name: 'Export as regression fixture' }));
    await waitFor(() => expect(spies.exportExploitFixture).toHaveBeenCalledWith(FIXTURE_RUN_ID, 'c-0009'));
  });

  it('keeps the standard-run lane empty', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    fireEvent.click(screen.getByRole('tab', { name: /^Guardrails/ }));
    expect(screen.getByTestId('exploits-found-lane').getAttribute('data-state')).toBe('empty');
  });
});

describe('candidate drawer audit section', () => {
  const drawer = (id: string) => screen.getByRole('dialog', { name: `Candidate ${id}` });
  const section = (id: string) => within(drawer(id)).getByRole('region', { name: 'Audit' });

  it('not audited: explains the audit and offers Run audit, which calls the store', async () => {
    seedPopulated({ candidateId: 'c-0003' });
    const spies = spyOnActions(['auditCandidate']);
    renderOn(<DiscoveryWorkbench />);
    expect(section('c-0003').textContent).toContain('Not audited');
    fireEvent.click(within(drawer('c-0003')).getByRole('button', { name: 'Run audit' }));
    await waitFor(() => expect(spies.auditCandidate).toHaveBeenCalledWith(FIXTURE_RUN_ID, 'c-0003'));
  });

  it('Run audit is available in any mode (a hybrid run) and disabled while the run is live or the candidate is not scored', () => {
    seedPopulated({ candidateId: 'c-0004' });
    renderOn(<DiscoveryWorkbench />);
    expect((within(drawer('c-0004')).getByRole('button', { name: 'Run audit' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    resetDiscoveryTestState();
    seedPopulated({ candidateId: 'c-0003', liveRunIds: [FIXTURE_RUN_ID], run: { status: 'running', stop_reason: null } });
    renderOn(<DiscoveryWorkbench />);
    expect((within(drawer('c-0003')).getByRole('button', { name: 'Run audit' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('pending: shows the waiting state', () => {
    seedPopulated({ candidateId: 'c-0003', candidates: withAudit('c-0003', { audit_pending: true }) });
    renderOn(<DiscoveryWorkbench />);
    expect(section('c-0003').textContent).toContain('Audit pending');
    expect(section('c-0003').textContent).toContain('Waiting for the kernel');
  });

  it('exploit: verdict, fitness comparison, reasons, checks and fingerprints', () => {
    seedPopulated({ candidateId: 'c-0009', candidates: withAudit('c-0009', { audit: EXPLOIT }) });
    renderOn(<DiscoveryWorkbench />);
    const s = section('c-0009');
    expect(within(s).getByText('Exploit')).toBeTruthy();
    expect(within(s).getByRole('alert').textContent).toContain('The audit rejects what the evaluator scored well');
    expect(within(s).getByText('Evaluator fitness').nextElementSibling?.textContent).toBe('2.9');
    expect(within(s).getByText('Audit fitness').nextElementSibling?.textContent).toBe('0.4');
    expect(within(s).getByText('Gap').nextElementSibling?.textContent).toBe('2.5');
    expect(within(s).getByRole('list', { name: 'Audit reasons' }).textContent).toContain('determinism only holds under the evaluator seed');
    const checks = within(s).getByRole('list', { name: 'Audit checks' });
    expect(within(checks).getAllByRole('listitem')).toHaveLength(2);
    expect(checks.textContent).toContain('observable flipped under seed 99');
    expect(within(s).getByText('Audit fingerprint').nextElementSibling?.textContent).toBe(`${'a'.repeat(16)}…`);
    expect(within(s).getByText('Evaluator fingerprint').nextElementSibling?.textContent).toBe(`${'f'.repeat(16)}…`);
  });

  it('consistent and inconclusive verdicts render without the exploit alert', () => {
    seedPopulated({ candidateId: 'c-0003', candidates: withAudit('c-0003', { audit: makeAudit({ gap: 0 }) }) });
    renderOn(<DiscoveryWorkbench />);
    expect(within(section('c-0003')).getByText('Consistent')).toBeTruthy();
    expect(within(section('c-0003')).queryByRole('alert')).toBeNull();
    cleanup();
    resetDiscoveryTestState();
    seedPopulated({ candidateId: 'c-0003', candidates: withAudit('c-0003', { audit: makeAudit({ verdict: 'inconclusive', gap: null, audit_fitness: null, reasons: ['audit budget exhausted'] }) }) });
    renderOn(<DiscoveryWorkbench />);
    expect(within(section('c-0003')).getByText('Inconclusive')).toBeTruthy();
    expect(section('c-0003').textContent).toContain('audit budget exhausted');
  });

  it('a failed audit request shows the reason', () => {
    seedPopulated({ candidateId: 'c-0003', candidates: withAudit('c-0003', { audit_error: 'unknown_evaluator: no audit for this evaluator' }) });
    renderOn(<DiscoveryWorkbench />);
    expect(section('c-0003').textContent).toContain('Audit failed');
    expect(section('c-0003').textContent).toContain('unknown_evaluator: no audit for this evaluator');
  });
});

describe('Red Queen run header and KPIs', () => {
  it('shows a danger-tone "Red Queen" chip, an Audits meter and an Exploits KPI', () => {
    seedPopulated({ run: rqRun, candidates: withAudit('c-0009', { audit: EXPLOIT }) });
    renderOn(<DiscoveryWorkbench />);
    const header = screen.getByRole('region', { name: 'Run header' });
    expect(header.getAttribute('data-mode')).toBe('red_queen');
    const chip = within(header).getByText('Red Queen');
    expect(chip.closest('.lab-pill')?.className).toContain('lab-pill--danger');
    expect(within(header).getAllByRole('meter').map((m) => m.getAttribute('aria-label'))).toEqual(['Evaluations', 'LLM calls', 'Audits', 'Wall time']);
    const kpis = screen.getByRole('group', { name: 'Run KPIs' });
    expect(within(kpis).getByText('Exploits')).toBeTruthy();
    expect(within(kpis).queryByText('Improvements by mutator')).toBeNull();
    expect(kpis.textContent).toContain('1 audit');
  });

  it('standard runs show neither the chip nor the Exploits KPI', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    expect(within(screen.getByRole('region', { name: 'Run header' })).queryByText('Red Queen')).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Run KPIs' })).queryByText('Exploits')).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Run KPIs' })).getByText('Improvements by mutator')).toBeTruthy();
  });
});

describe('wizard Red Queen option', () => {
  it('offers "Red Queen (audit the evaluator)" for every template and explains it', () => {
    renderOn(<NewDiscoveryWizard />);
    expect(screen.queryByTestId('red-queen-options')).toBeNull();
    for (const radio of screen.getAllByRole('radio')) {
      fireEvent.click(radio);
      expect(screen.getByRole('tab', { name: 'Red Queen (audit the evaluator)' })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Red Queen (audit the evaluator)' }));
    const options = screen.getByTestId('red-queen-options');
    expect(options.textContent).toContain('security testing of Nuclei');
    expect(options.textContent).toContain('evidence of robustness, not proof');
  });

  it('creates a red_queen discovery with the audit settings', async () => {
    const create = vi.fn(async () => ({ ok: true as const, definitionFile: 'x.discovery.yaml' }));
    useDiscoveryStore.setState({ createFromTemplate: create as never });
    renderOn(<NewDiscoveryWizard />);
    fireEvent.click(screen.getByRole('tab', { name: 'Red Queen (audit the evaluator)' }));
    fireEvent.change(screen.getByLabelText('Audit when'), { target: { value: 'top_k' } });
    const topK = screen.getByLabelText('Top k');
    fireEvent.change(topK, { target: { value: '3' } });
    fireEvent.blur(topK);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'rq' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create discovery' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      'qec-repetition-schedule', 'rq',
      expect.objectContaining({ max_llm_calls: 160 }),
      expect.objectContaining({ kind: 'red_queen', red_queen: { audit_every: 'top_k', top_k: 3, max_audits: 50 } }),
    );
  });
});
