// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { DiscoveryWorkbench } from './DiscoveryWorkbench';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { createArchive } from '../../services/discovery/archive';
import { FIXTURE_EVALUATOR, FIXTURE_RUN_ID, fixtureRun, fixtureSpec } from '../../services/discovery/fixtures';
import { computeKpis } from '../../services/discovery/kpis';
import { createRunView } from '../../services/discovery/runView';
import { renderOn, resetDiscoveryTestState, seedPopulated, spyOnActions } from './testUtils';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: (props: { original: string; modified: string }) => <div data-testid="monaco-diff" data-original={props.original} data-modified={props.modified} />,
  default: () => null,
  loader: { config: () => undefined },
}));

beforeEach(() => resetDiscoveryTestState());
afterEach(() => cleanup());

function seedEmptyRun(patch: Parameters<typeof fixtureRun>[0] = {}) {
  seedPopulated();
  const archive = createArchive([
    { key: 'two_qubit_gates', label: 'Two-qubit gates', min: 0, max: 16, bins: 4 },
    { key: 'depth', label: 'Circuit depth', min: 0, max: 32, bins: 4 },
  ], FIXTURE_EVALUATOR.objectives, 2);
  const run = fixtureRun({ archive, champion_id: null, seed_fitness: null, status: 'running', stop_reason: null, finished_at: null, best_fitness_history: [], ...patch });
  useDiscoveryStore.setState({ views: { [FIXTURE_RUN_ID]: createRunView(run, []) }, kpis: { [FIXTURE_RUN_ID]: computeKpis(run, []) }, runsByDefinition: {} });
}

const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));

describe('run header and controls', () => {
  it('shows name, evaluator and mutator chips, status and the three budget meters', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    const header = screen.getByRole('region', { name: 'Run header' });
    expect(within(header).getByText('w-state-synthesis')).toBeTruthy();
    expect(within(header).getByText('State synthesis')).toBeTruthy();
    expect(within(header).getByText('Hybrid · haiku/opus')).toBeTruthy();
    expect(within(header).getByText('Completed')).toBeTruthy();
    expect(within(header).getAllByRole('meter').map((m) => m.getAttribute('aria-label'))).toEqual(['Evaluations', 'LLM calls', 'Wall time']);
  });

  it('a running live run offers Pause and Stop that call the store', () => {
    seedPopulated({ liveRunIds: [FIXTURE_RUN_ID], run: { status: 'running', stop_reason: null } });
    const spies = spyOnActions(['pauseRun', 'stopRun']);
    renderOn(<DiscoveryWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(spies.pauseRun).toHaveBeenCalledWith(FIXTURE_RUN_ID);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(spies.stopRun).toHaveBeenCalledWith(FIXTURE_RUN_ID);
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  it('a paused live run offers Resume', () => {
    seedPopulated({ liveRunIds: [FIXTURE_RUN_ID], run: { status: 'paused', stop_reason: null } });
    const spies = spyOnActions(['resumeRun']);
    renderOn(<DiscoveryWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(spies.resumeRun).toHaveBeenCalledWith(FIXTURE_RUN_ID);
  });

  it('a stale run is labeled, explained and resumable; New run starts the definition', () => {
    seedPopulated({ run: { status: 'stale', stop_reason: null } });
    const spies = spyOnActions(['resumeRun', 'startRun']);
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByText('This run is stale')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(spies.resumeRun).toHaveBeenCalledWith(FIXTURE_RUN_ID);
    fireEvent.click(screen.getByRole('button', { name: /New run/ }));
    expect(spies.startRun).toHaveBeenCalledWith('w-state-synthesis.discovery.yaml');
  });

  it('a completed run cannot be resumed; its controls are blocked while another run is live', () => {
    seedPopulated({ liveRunIds: ['other-run'] });
    renderOn(<DiscoveryWorkbench />);
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect((screen.getByRole('button', { name: /New run/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('KPI strip and notices', () => {
  it('shows best fitness with the delta against the seed, counts, shares and tokens', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    const kpis = screen.getByRole('group', { name: 'Run KPIs' });
    expect(within(kpis).getByText('2.9')).toBeTruthy();
    expect(kpis.textContent).toContain('+1.9 vs seed');
    const breakdown = within(kpis).getByLabelText('Evaluations breakdown');
    expect(breakdown.textContent).toContain('scored');
    expect(breakdown.textContent).toContain('screened out');
    expect(breakdown.textContent).toContain('duplicate');
    expect(kpis.textContent).toContain('not yet confirmed');
    expect(kpis.textContent).toMatch(/\d+% LLM/);
    expect(kpis.textContent).toContain('cached');
  });

  it('shows the confirmed objective once confirmed', () => {
    seedPopulated({ confirmed: true });
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByRole('group', { name: 'Run KPIs' }).textContent).toContain('confirmed 0.0062');
  });

  it('renders runner notices, such as the API-key fallback', () => {
    seedPopulated();
    const view = useDiscoveryStore.getState().views[FIXTURE_RUN_ID];
    useDiscoveryStore.setState({ views: { [FIXTURE_RUN_ID]: { ...view, notices: ['No API key: hybrid fell back to AST'] } } });
    renderOn(<DiscoveryWorkbench />);
    expect(within(screen.getByRole('region', { name: 'Run notices' })).getByText('No API key: hybrid fell back to AST')).toBeTruthy();
  });

  it('a Frontier run carries the honesty callout', () => {
    seedPopulated();
    const view = useDiscoveryStore.getState().views[FIXTURE_RUN_ID];
    const spec = fixtureSpec({ evaluator: { kind: 'trainability_frontier', config: {} } });
    useDiscoveryStore.setState({ views: { [FIXTURE_RUN_ID]: { ...view, run: { ...view.run, spec } } } });
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getAllByText(/not a proof of classical hardness/).length).toBeGreaterThan(0);
  });

  it('an empty run shows em dashes, never NaN', () => {
    seedEmptyRun();
    renderOn(<DiscoveryWorkbench />);
    const kpis = screen.getByRole('group', { name: 'Run KPIs' });
    expect(kpis.textContent).not.toMatch(/NaN|undefined/);
    expect(kpis.textContent).toContain('no champion yet');
  });
});

describe('tabs: empty run', () => {
  it('every tab has a designed empty state', () => {
    seedEmptyRun();
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByText('Nothing evaluated yet')).toBeTruthy();
    expect(screen.getByText('No champion yet')).toBeTruthy();
    expect(screen.getByText('No Pareto front yet')).toBeTruthy();
    openTab('Lineage');
    expect(screen.getByText('No lineage yet')).toBeTruthy();
    openTab('Archive');
    expect(screen.getByText('The archive is empty')).toBeTruthy();
    openTab('Candidates');
    expect(screen.getByText('No candidates yet')).toBeTruthy();
    openTab('Guardrails');
    expect(screen.getByText('No rejections')).toBeTruthy();
    expect(screen.getByTestId('exploits-found-lane').getAttribute('data-state')).toBe('empty');
  });
});

describe('Overview tab', () => {
  it('names its charts and gives each a text summary', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    const trajectory = screen.getByRole('img', { name: 'Fitness trajectory' });
    expect(trajectory.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(trajectory.getAttribute('aria-describedby') as string)?.textContent).toMatch(/scored, 2 rejected, 1 failed, 1 screened out/);
    const pareto = screen.getByRole('img', { name: 'Pareto front' });
    expect(document.getElementById(pareto.getAttribute('aria-describedby') as string)?.textContent).toMatch(/Pareto front of \d+ of \d+ archived candidates/);
  });

  it('champion card shows the diff against the seed and promotes', async () => {
    seedPopulated();
    const promote = vi.fn(async () => ({ ok: true as const, path: 'discovery/w_state.c-0009.py' }));
    useDiscoveryStore.setState({ promoteCandidate: promote });
    renderOn(<DiscoveryWorkbench />);
    const card = screen.getByRole('region', { name: /Champion c-0009/ });
    expect((await within(card).findByTestId('monaco-diff')).getAttribute('data-original')).toContain('# program c-0000');
    fireEvent.click(within(card).getByRole('button', { name: /Promote/ }));
    expect(promote).toHaveBeenCalledWith(FIXTURE_RUN_ID, 'c-0009');
    expect(await within(card).findByText('Wrote discovery/w_state.c-0009.py')).toBeTruthy();
  });

  it('Confirm on fresh seeds calls the store; it is disabled while the run is live', () => {
    seedPopulated();
    const spies = spyOnActions(['confirmChampion']);
    renderOn(<DiscoveryWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Confirm on fresh seeds/ }));
    expect(spies.confirmChampion).toHaveBeenCalledWith(FIXTURE_RUN_ID);
    cleanup();
    seedPopulated({ liveRunIds: [FIXTURE_RUN_ID] });
    renderOn(<DiscoveryWorkbench />);
    expect((screen.getByRole('button', { name: /Confirm on fresh seeds/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the confirmed mean with its interval and the winner\'s-curse drop', () => {
    seedPopulated({ confirmed: true });
    renderOn(<DiscoveryWorkbench />);
    const confirmed = screen.getByRole('region', { name: 'Confirmed on fresh seeds' });
    expect(confirmed.textContent).toContain('Confirmed');
    expect(confirmed.textContent).toContain('2.7');
    expect(confirmed.textContent).toContain('Drop vs search score');
  });

  it('shows a pending confirmation as busy', () => {
    seedPopulated({ pendingActions: { [`${FIXTURE_RUN_ID}:confirm`]: true } });
    renderOn(<DiscoveryWorkbench />);
    expect(screen.getByRole('button', { name: /Confirming/ })).toBeTruthy();
  });
});

describe('Lineage tab', () => {
  it('draws every candidate, marks improvements and opens the drawer on click', () => {
    seedPopulated();
    const { container } = renderOn(<DiscoveryWorkbench />);
    openTab('Lineage');
    const nodes = container.querySelectorAll('.disc-lineage__node');
    expect(nodes).toHaveLength(9);
    fireEvent.click(screen.getByLabelText(/Show 2 duplicate \/ invalid/));
    expect(container.querySelectorAll('.disc-lineage__node')).toHaveLength(11);
    expect(container.querySelectorAll('.disc-lineage__ring').length).toBe(4);
    const target = container.querySelector('[data-id="c-0004"] circle:last-of-type') as Element;
    fireEvent.click(target);
    expect(useDiscoveryStore.getState().selectedCandidateId).toBe('c-0004');
    expect(screen.getByRole('dialog', { name: 'Candidate c-0004' })).toBeTruthy();
  });

  it('rejected nodes are hollow with a danger stroke', () => {
    seedPopulated();
    const { container } = renderOn(<DiscoveryWorkbench />);
    openTab('Lineage');
    const circle = container.querySelector('[data-id="c-0004"] circle') as SVGCircleElement;
    expect(circle.getAttribute('stroke')).toBe('var(--color-danger)');
    expect(circle.getAttribute('fill')).toBe('var(--lab-surface-2)');
  });

  it('is keyboard navigable: arrows move, Enter opens', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    openTab('Lineage');
    const tree = screen.getByRole('group', { name: 'Lineage tree' });
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(screen.getByRole('status').textContent).toMatch(/^c-0003/);
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(useDiscoveryStore.getState().selectedCandidateId).toBe('c-0003');
  });

  it('stays quick with about 500 nodes', () => {
    seedPopulated();
    const base = useDiscoveryStore.getState().views[FIXTURE_RUN_ID];
    const template = base.candidates['c-0001'];
    const many = Array.from({ length: 500 }, (_, i) => ({ ...template, id: `c-${String(i).padStart(4, '0')}`, parent_id: i === 0 ? null : `c-${String(Math.floor((i - 1) / 2)).padStart(4, '0')}` }));
    useDiscoveryStore.setState({ views: { [FIXTURE_RUN_ID]: createRunView(base.run, many) } });
    const started = performance.now();
    const { container } = renderOn(<DiscoveryWorkbench />);
    openTab('Lineage');
    expect(container.querySelectorAll('.disc-lineage__node')).toHaveLength(500);
    expect(performance.now() - started).toBeLessThan(4000);
  });
});

describe('Archive tab', () => {
  it('draws the grid, hatches empty cells, reports coverage and switches islands', () => {
    seedPopulated();
    const { container } = renderOn(<DiscoveryWorkbench />);
    openTab('Archive');
    expect(container.querySelectorAll('.disc-archive__cell')).toHaveLength(16);
    expect(container.querySelectorAll('.disc-archive__cell--empty').length).toBeGreaterThan(0);
    expect(screen.getByRole('status').textContent).toBe('Coverage 19% · 3/16 cells');
    fireEvent.click(screen.getByRole('tab', { name: 'Island 2' }));
    expect(screen.getByRole('status').textContent).toBe('Coverage 6% · 1/16 cells');
    fireEvent.click(within(container.querySelector('.disc-archive') as HTMLElement).getAllByRole('button')[0]);
    expect(useDiscoveryStore.getState().selectedCandidateId).toMatch(/^c-/);
  });
});

describe('Candidates tab', () => {
  it('lists every candidate, sorts by fitness and filters by status', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    openTab('Candidates');
    const table = screen.getByRole('table', { name: 'Candidates' });
    expect(within(table).getAllByRole('row')).toHaveLength(12);
    fireEvent.click(within(table).getByRole('button', { name: 'Fitness' }));
    expect(within(table).getAllByRole('row')[1].textContent).toContain('c-0009');
    expect(within(table).getByRole('columnheader', { name: 'Fitness' }).getAttribute('aria-sort')).toBe('descending');
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'rejected' } });
    expect(within(screen.getByRole('table', { name: 'Candidates' })).getAllByRole('row')).toHaveLength(3);
  });

  it('shows a clear-filters state when nothing matches', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    openTab('Candidates');
    fireEvent.change(screen.getByLabelText('Search candidate id'), { target: { value: 'zzz' } });
    expect(screen.getByText('No candidates match these filters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('table', { name: 'Candidates' })).toBeTruthy();
  });

  it('opens a row on Enter', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    openTab('Candidates');
    const row = within(screen.getByRole('table', { name: 'Candidates' })).getAllByRole('row')[2];
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(useDiscoveryStore.getState().selectedCandidateId).toBe('c-0001');
  });
});

describe('Guardrails tab', () => {
  it('lists rejection reasons that link to their candidates, pass rates, isolation and the empty Exploits lane', () => {
    seedPopulated();
    renderOn(<DiscoveryWorkbench />);
    openTab('Guardrails');
    expect(screen.getByRole('img', { name: 'Rejections by guardrail' })).toBeTruthy();
    const reasons = screen.getByRole('list', { name: 'Rejection reasons' });
    expect(reasons.textContent).toContain('No noise channels');
    fireEvent.click(within(reasons).getByRole('button', { name: /Open c-0004/ }));
    expect(useDiscoveryStore.getState().selectedCandidateId).toBe('c-0004');
    expect(within(screen.getByRole('table', { name: 'Guardrail pass rates' })).getByText('Elementary gates only')).toBeTruthy();
    const isolation = screen.getByRole('list', { name: 'Isolation modes used' });
    expect(isolation.textContent).toContain('sandbox-exec');
    expect(screen.getByText('File reads are being restricted')).toBeTruthy();
    const lane = screen.getByTestId('exploits-found-lane');
    expect(lane.getAttribute('data-state')).toBe('empty');
    expect(lane.textContent).toContain('Red Queen');
  });
});
