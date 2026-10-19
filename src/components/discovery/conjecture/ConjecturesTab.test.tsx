// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fixtureConjecture, fixtureEvidenceItem, fixtureResult, fixtureSchema, frontierFixture, FRONTIER_RUN_ID } from '../../../services/conjecture/fixtures';
import { normalizeEvidence } from '../../../services/conjecture/evidence';
import { emptyLedger, ledgerPaths, saveLedger, upsertEntry } from '../../../services/conjecture/ledger';
import { emptyRunConjectures, type Proposal, type RunConjectures, type TestJob } from '../../../services/conjecture/state';
import { platformJoin } from '../../../services/discovery/platformFs';
import { createMemoryFs } from '../../../services/discovery/testkit';
import { useConjectureStore } from '../../../stores/conjectureStore';
import { useDiracStore } from '../../../stores/diracStore';
import { useDiscoveryStore, type RunView } from '../../../stores/discoveryStore';
import { useProjectStore } from '../../../stores/projectStore';
import type { ConjectureResult, LedgerEntry } from '../../../types/conjecture';
import { renderOn } from '../testUtils';
import { ConjecturesTab } from './ConjecturesTab';
import { __resetConjectureBoot } from './useConjectureBoot';

const hoisted = vi.hoisted(() => ({ fs: null as unknown }));
vi.mock('../../../services/conjecture/env', async () => {
  const { platformJoin: join } = await import('../../../services/discovery/platformFs');
  return {
    createConjectureEnv: () => ({
      get fs() { return hoisted.fs; },
      join,
      hash: async () => 'a'.repeat(64),
      now: () => new Date('2026-10-18T15:00:00.000Z'),
      proposer: { hasKey: () => true, propose: async () => ({ ok: false, code: 'network', message: 'offline', usage: null, prompt_sha256: null }) },
      openSession: async () => { throw new Error('no kernel in tests'); },
    }),
  };
});

const NOW = '2026-10-18T15:00:00.000Z';
const USAGE = { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const META = { model: 'claude-opus-5-5', prompt_sha256: 'f'.repeat(64), usage: USAGE, proposed_at: NOW, digest_disclosure: 'Digest shows 12 of 12.' };
const RUN_DIR = `/proj/experiments/w-state-synthesis/discovery/${FRONTIER_RUN_ID}`;

let view: RunView;

function seed(opts: { count?: number; live?: boolean; key?: boolean } = {}) {
  const fx = frontierFixture(opts.count ?? 12);
  view = { run: fx.run, candidates: fx.candidates, order: Object.keys(fx.candidates), activity: {}, notices: [] };
  useProjectStore.setState({ projectRoot: '/proj' });
  useDiscoveryStore.setState({ projectRoot: '/proj', views: { [FRONTIER_RUN_ID]: view }, liveRunIds: opts.live ? [FRONTIER_RUN_ID] : [] });
  useDiracStore.setState({ apiKey: opts.key === false ? null : 'sk-test' });
}

const proposal = (id: string, extra: Partial<Proposal> = {}): Proposal => ({ conjecture: fixtureConjecture({ id }), decision: 'draft', meta: META, edited: false, ...extra });
const job = (id: string, extra: Partial<TestJob> = {}): TestJob => ({
  jobId: 'j', conjectureId: id, status: 'running', fraction: 0.4, message: 'circuit 3', circuitIndex: 2, evidence: [], result: null, error: null, seed: 1, startedAt: NOW, ledgerError: null, ...extra,
});
const rowsOf = (result: ConjectureResult) => result.evidence.map((e, i) => normalizeEvidence(e, i));
const put = (patch: Partial<RunConjectures>, schema = true) =>
  useConjectureStore.setState({ byRun: { [FRONTIER_RUN_ID]: { ...emptyRunConjectures(), ...patch } }, schema: schema ? fixtureSchema() : null });
const finished = (id: string, verdict: ConjectureResult['verdict']) => {
  const result = fixtureResult(verdict);
  return job(id, { status: 'complete', fraction: 1, result, evidence: rowsOf(result) });
};
const renderTab = () => renderOn(<ConjecturesTab view={view} />);

beforeEach(() => {
  hoisted.fs = createMemoryFs();
  useConjectureStore.getState().reset();
  __resetConjectureBoot();
  seed();
});
afterEach(() => cleanup());

describe('header states', () => {
  it('explains a missing API key and disables Propose', () => {
    seed({ key: false });
    renderTab();
    expect(screen.getByRole('button', { name: 'Propose conjectures' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('status', { name: '' , hidden: true }) || true).toBeTruthy();
    expect(screen.getAllByText(/Add an Anthropic API key/).length).toBeGreaterThan(0);
    expect(screen.getByText('No conjectures yet')).toBeTruthy();
  });

  it('explains too few scored elites', () => {
    seed({ count: 5 });
    renderTab();
    expect(screen.getAllByText(/at least 8 scored archive elites; this run has 5/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Propose conjectures' }).hasAttribute('disabled')).toBe(true);
  });

  it('is disabled while the run is still live', () => {
    seed({ live: true });
    renderTab();
    expect(screen.getByText(/run is still active/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Propose conjectures' }).hasAttribute('disabled')).toBe(true);
  });

  it('is enabled when ready and discloses the digest', () => {
    renderTab();
    expect(screen.getByRole('button', { name: 'Propose conjectures' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByLabelText('Digest disclosure').textContent).toContain('Digest shows 12 of 12 scored archive elites');
  });

  it('calls propose and shows a proposer error', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Propose conjectures' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not propose conjectures'));
  });

  it('shows a loading state while proposing', () => {
    put({ proposing: true });
    renderTab();
    expect(screen.getByRole('progressbar', { name: 'Claude is reading the archive digest' })).toBeTruthy();
    expect(screen.getByLabelText('Waiting for proposals')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Proposing' }).hasAttribute('disabled')).toBe(true);
  });

  it('reports dropped proposals', () => {
    put({ dropped: [{ index: 1, issues: [{ path: 'n_range', message: 'must be low' }] }] });
    renderTab();
    expect(screen.getByText(/1 proposed conjecture dropped/)).toBeTruthy();
  });
});

describe('proposal cards', () => {
  it('shows statement, predicate chips, prediction, family and n range', () => {
    put({ proposals: [proposal('cj-1')] });
    renderTab();
    const card = screen.getByRole('region', { name: 'Conjecture cj-1' });
    expect(within(card).getByText(/Brick-pattern CZ circuits/)).toBeTruthy();
    expect(within(card).getByText('entangler_pattern == brick')).toBeTruthy();
    expect(within(card).getByText('n_layers <= 6')).toBeTruthy();
    expect(within(card).getByText('beta_upper95 < 0.1')).toBeTruthy();
    expect(within(card).getByText(/layered, rotation axes YZ/)).toBeTruthy();
    expect(within(card).getByText('8 to 128 qubits, 5 points')).toBeTruthy();
    expect(within(card).getByText('Draft')).toBeTruthy();
  });

  it('accepts, rejects and restores', () => {
    put({ proposals: [proposal('cj-1')] });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Accept/ }));
    expect(screen.getByText('Accepted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Reject/ }));
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('rejects an invalid edit with the schema path and saves a valid one', () => {
    put({ proposals: [proposal('cj-1')] });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    const form = screen.getByRole('form', { name: 'Edit cj-1' });
    fireEvent.change(within(form).getByLabelText(/Feature predicate/), { target: { value: '{"all":[{"feature":"magic","op":"==","value":1}]}' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save edits' }));
    expect(within(form).getByRole('alert').textContent).toContain('feature_predicate.all[0].feature');
    fireEvent.change(within(form).getByLabelText(/Feature predicate/), { target: { value: '{"all":[{"feature":"n_layers","op":"<=","value":4}]}' } });
    fireEvent.change(within(form).getByLabelText('Statement'), { target: { value: 'Shallow circuits stay trainable.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save edits' }));
    expect(screen.getByText('Shallow circuits stay trainable.')).toBeTruthy();
    expect(screen.getByText('Edited')).toBeTruthy();
    expect(screen.getByText('n_layers <= 4')).toBeTruthy();
  });
});

describe('a test in progress', () => {
  it('shows progress and streams evidence rows with pills and sparklines', () => {
    const ev = [normalizeEvidence(fixtureEvidenceItem(0, 'meets'), 0), normalizeEvidence(fixtureEvidenceItem(1, 'violates'), 1)];
    put({ proposals: [proposal('cj-1', { decision: 'accepted' })], jobs: { 'cj-1': job('cj-1', { evidence: ev }) } });
    renderTab();
    expect(screen.getByRole('progressbar', { name: 'Testing cj-1' }).getAttribute('aria-valuenow')).toBe('40');
    expect(screen.getByText(/2 of 8 circuits/)).toBeTruthy();
    const rows = within(screen.getByLabelText(/Evidence from 2 of 8/)).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Meets')).toBeTruthy();
    expect(within(rows[1]).getByText('Violates')).toBeTruthy();
    expect(within(rows[0]).getByRole('img', { name: /Circuit 1 scaling: gradient variance falls/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeTruthy();
  });

  it('disables Test elsewhere while a job is active and cancels through the store', () => {
    const cancel = vi.fn(async () => undefined);
    useConjectureStore.setState({ cancel });
    put({ proposals: [proposal('cj-1', { decision: 'accepted' }), proposal('cj-2')], jobs: { 'cj-1': job('cj-1') } });
    renderTab();
    const other = screen.getByRole('region', { name: 'Conjecture cj-2' });
    expect(within(other).getByRole('button', { name: 'Test' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel/ }));
    expect(cancel).toHaveBeenCalledWith(FRONTIER_RUN_ID, 'cj-1');
  });

  it('shows a starting job as indeterminate', () => {
    put({ proposals: [proposal('cj-1', { decision: 'accepted' })], jobs: { 'cj-1': job('cj-1', { status: 'starting', fraction: 0 }) } });
    renderTab();
    expect(screen.getByRole('progressbar', { name: 'Testing cj-1' }).hasAttribute('aria-valuenow')).toBe(false);
  });

  it('shows a failed start with the kernel message', () => {
    put({ proposals: [proposal('cj-1', { decision: 'accepted' })], jobs: { 'cj-1': job('cj-1', { status: 'failed', error: { code: 'conjecture_busy', message: 'Another conjecture test is running.' } }) } });
    renderTab();
    expect(screen.getByText('Another conjecture test is running.')).toBeTruthy();
  });
});

describe('verdict cards', () => {
  it('supported: honest wording, chart, fingerprint and timing', () => {
    put({ proposals: [proposal('cj-1', { decision: 'accepted' })], jobs: { 'cj-1': finished('cj-1', 'supported') } });
    renderTab();
    const verdict = screen.getByRole('region', { name: 'Verdict: supported' });
    expect(within(verdict).getByText('Supported')).toBeTruthy();
    expect(within(verdict).getByText(/supported on 8 held-out circuits up to n = 128/)).toBeTruthy();
    expect(within(verdict).getByText(/not a proof/)).toBeTruthy();
    expect(within(verdict).getByRole('img', { name: 'Gradient variance scaling per held-out circuit' })).toBeTruthy();
    expect(within(verdict).getByText(/Evaluator fingerprint cdcdcdcdcdcdcdcd/)).toBeTruthy();
    expect(within(verdict).getAllByText(/18 s/).length).toBeGreaterThan(0);
    expect(verdict.textContent).not.toMatch(/\bproven\b/);
  });

  it('refuted: counterexample card writes a Qiskit file and opens it', async () => {
    const open = vi.fn();
    useProjectStore.setState({ openTab: open });
    const write = vi.fn(async () => ({ ok: true as const, path: `${RUN_DIR}/counterexamples/cj-1-cx1.py`, code: 'from qiskit import QuantumCircuit' }));
    useConjectureStore.setState({ writeCounterexample: write });
    put({ proposals: [proposal('cj-1', { decision: 'accepted' })], jobs: { 'cj-1': finished('cj-1', 'refuted') } });
    renderTab();
    expect(screen.getByText('Refuted')).toBeTruthy();
    const cx = screen.getByRole('group', { name: 'Counterexample 1' });
    expect(within(cx).getByText('layers 6, axis order per layer YZ, brick start even')).toBeTruthy();
    fireEvent.click(within(cx).getByRole('button', { name: 'Open counterexample as file' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith({ path: `${RUN_DIR}/counterexamples/cj-1-cx1.py`, content: 'from qiskit import QuantumCircuit' }));
    expect(write).toHaveBeenCalledWith(FRONTIER_RUN_ID, 'cj-1', 0);
  });

  it('refuted: shows the error when the file cannot be written', async () => {
    useConjectureStore.setState({ writeCounterexample: vi.fn(async () => ({ ok: false as const, error: 'disk full' })) });
    put({ proposals: [proposal('cj-1', { decision: 'accepted' })], jobs: { 'cj-1': finished('cj-1', 'refuted') } });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Open counterexample as file' }));
    await waitFor(() => expect(screen.getByText('disk full')).toBeTruthy());
  });

  it('inconclusive: neutral explanation, no counterexamples', () => {
    put({ proposals: [proposal('cj-1', { decision: 'accepted' })], jobs: { 'cj-1': finished('cj-1', 'inconclusive') } });
    renderTab();
    const verdict = screen.getByRole('region', { name: 'Verdict: inconclusive' });
    expect(within(verdict).getByText('Inconclusive')).toBeTruthy();
    expect(within(verdict).queryByText('Counterexamples')).toBeNull();
    expect(within(verdict).getAllByText('Indeterminate').length).toBe(3);
  });

  it('inconclusive: the sentence is not repeated three times', () => {
    put({ proposals: [proposal('cj-1', { decision: 'accepted' })], jobs: { 'cj-1': finished('cj-1', 'inconclusive') } });
    renderTab();
    const verdict = screen.getByRole('region', { name: 'Verdict: inconclusive' });
    expect(verdict.textContent).not.toMatch(/Inconclusive: /);
    expect(verdict.textContent?.match(/circuit\(s\) were indeterminate/g)?.length).toBe(1);
  });

  it('explains why Test is disabled while another conjecture is being tested', () => {
    put({ proposals: [proposal('cj-1'), proposal('cj-2')], jobs: { 'cj-2': job('cj-2') } });
    renderTab();
    expect(screen.getAllByTestId('test-blocked-reason')[0].textContent).toMatch(/Another conjecture is being tested/);
  });

  it('warns when the result could not be saved to the ledger', () => {
    const j = { ...finished('cj-1', 'supported'), ledgerError: 'read-only volume' };
    put({ proposals: [proposal('cj-1', { decision: 'accepted' })], jobs: { 'cj-1': j } });
    renderTab();
    expect(screen.getByText('Result not saved to the ledger')).toBeTruthy();
    expect(screen.getByText('read-only volume')).toBeTruthy();
  });
});

describe('ledger', () => {
  const entry = (id: string, verdict: 'supported' | 'refuted' | 'inconclusive' | null): LedgerEntry => ({
    id, conjecture: fixtureConjecture({ id, statement: `Statement of ${id}` }), proposer: META, outcome: verdict ? 'complete' : 'failed',
    result: verdict ? fixtureResult(verdict) : null, error: verdict ? null : 'kernel disconnected', seed: 3, tested_at: `2026-10-18T15:0${id.length}:00.000Z`,
  });

  it('empty: designed empty state, Open ledger disabled', async () => {
    renderTab();
    expect(await screen.findByText('No conjectures tested yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open ledger (.md)' }).hasAttribute('disabled')).toBe(true);
  });

  it('populated: lists every verdict, filters, expands details and opens the markdown', async () => {
    const fs = createMemoryFs();
    hoisted.fs = fs;
    let ledger = emptyLedger(FRONTIER_RUN_ID, NOW);
    for (const [id, v] of [['aa', 'supported'], ['bbb', 'refuted'], ['cccc', 'inconclusive'], ['ddddd', null]] as const) ledger = upsertEntry(ledger, entry(id, v), NOW);
    await saveLedger(fs, ledgerPaths(platformJoin, '/proj', 'w-state-synthesis.discovery.yaml', FRONTIER_RUN_ID), ledger);
    const open = vi.fn();
    useProjectStore.setState({ openTab: open });
    renderTab();
    const table = await screen.findByRole('table', { name: 'Conjecture ledger' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getByText('Did not finish')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Refuted/ }));
    expect(within(screen.getByRole('table', { name: 'Conjecture ledger' })).getAllByRole('row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Show details for bbb' }));
    expect(screen.getByRole('region', { name: 'Verdict: refuted' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open ledger (.md)' }));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(open.mock.calls[0][0].path).toBe(`${RUN_DIR}/conjectures.md`);
    expect(open.mock.calls[0][0].content).toContain('# Conjecture ledger');
  });

  it('shows a ledger error without hiding the rest of the tab', async () => {
    hoisted.fs = createMemoryFs({ [`${RUN_DIR}/conjectures.json`]: '{broken' });
    renderTab();
    expect(await screen.findByText('Ledger problem')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Propose conjectures' })).toBeTruthy();
  });
});

describe('platform', () => {
  it('explains that the web build has no kernel', () => {
    renderOn(<ConjecturesTab view={view} />, 'web');
    expect(screen.getByText('The Conjecture Engine needs the desktop kernel')).toBeTruthy();
  });
});
