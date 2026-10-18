import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConjectureEnv } from '../services/conjecture/env';
import { fixtureConjecture, fixtureResult, frontierFixture, FIXTURE_SCHEMA_REPLY, FRONTIER_RUN_ID } from '../services/conjecture/fixtures';
import type { ConjectureProposer, ProposeResult } from '../services/conjecture/proposer';
import { platformJoin } from '../services/discovery/platformFs';
import { createMemoryFs } from '../services/discovery/testkit';
import { createFakeSession, type FakeLabSession } from '../services/trainability/fakeSession';
import type { KernelMessage } from '../types/quantum';
import type { ConjectureResult } from '../types/conjecture';
import { isConjectureTestActive, useConjectureStore } from './conjectureStore';
import { useDiscoveryStore } from './discoveryStore';

const NOW = new Date('2026-10-18T15:00:00.000Z');
const USAGE = { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const hash = async (t: string) => (t.length.toString(16).padStart(8, '0') + 'a'.repeat(56)).slice(0, 64);

interface Harness {
  fs: ReturnType<typeof createMemoryFs>;
  session: FakeLabSession;
  proposals: ProposeResult[];
  keyed: { value: boolean };
}

function boot(script: (m: KernelMessage, s: FakeLabSession) => void = () => undefined, count = 12): Harness {
  const fs = createMemoryFs();
  const keyed = { value: true };
  const proposals: ProposeResult[] = [{
    ok: true, conjectures: [fixtureConjecture({ id: 'cj-t-1' }), fixtureConjecture({ id: 'cj-t-2', statement: 'Ring circuits are barren.' })],
    dropped: [], model: 'claude-opus-5-5', usage: USAGE, prompt_sha256: 'f'.repeat(64),
  }];
  const session = createFakeSession((m, s) => {
    if (m.type === 'discovery_conjecture_schema') s.emit(FIXTURE_SCHEMA_REPLY);
    else script(m, s);
  });
  const proposer: ConjectureProposer = { hasKey: () => keyed.value, propose: async () => proposals[0] };
  const env: ConjectureEnv = { fs, join: platformJoin, hash, now: () => NOW, proposer, openSession: async () => session };
  useConjectureStore.getState().reset();
  useConjectureStore.getState().configure(env);
  const fx = frontierFixture(count);
  useDiscoveryStore.setState({ projectRoot: '/proj', views: { [FRONTIER_RUN_ID]: { run: fx.run, candidates: fx.candidates, order: Object.keys(fx.candidates), activity: {}, notices: [] } }, liveRunIds: [] });
  return { fs, session, proposals, keyed };
}

const complete = (result: ConjectureResult) => (m: KernelMessage, s: FakeLabSession) => {
  if (m.type !== 'discovery_conjecture_test') return;
  s.emit({ type: 'discovery_conjecture_started', job_id: m.job_id });
  result.evidence.forEach((item, i) => {
    s.emit({ type: 'discovery_conjecture_progress', job_id: m.job_id, fraction: (i + 1) / result.evidence.length, message: `circuit ${i + 1}`, circuit_index: i });
    s.emit({ type: 'discovery_conjecture_evidence', job_id: m.job_id, item });
  });
  s.emit({ type: 'discovery_conjecture_result', job_id: m.job_id, status: 'complete', result });
};

const run = () => useConjectureStore.getState().byRun[FRONTIER_RUN_ID];
const LEDGER = '/proj/experiments/w-state-synthesis/discovery/' + FRONTIER_RUN_ID + '/conjectures.json';

beforeEach(() => useConjectureStore.getState().reset());

describe('conjectureStore.propose abort (CR-H6)', () => {
  it('cancelPropose aborts the request and clears proposing without an error banner', async () => {
    const h = boot();
    let signal: AbortSignal | undefined;
    const proposer: ConjectureProposer = {
      hasKey: () => true,
      propose: (_input, s) => new Promise((resolve) => {
        signal = s;
        s?.addEventListener('abort', () => resolve({ ok: false, code: 'aborted', message: 'The request was cancelled.', usage: null, prompt_sha256: null }));
      }),
    };
    useConjectureStore.getState().configure({
      fs: h.fs, join: platformJoin, hash, now: () => NOW, proposer, openSession: async () => h.session,
    });
    const pending = useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(run().proposing).toBe(true);
    useConjectureStore.getState().cancelPropose(FRONTIER_RUN_ID);
    expect(run().proposing).toBe(false);
    const res = await pending;
    expect(res.ok).toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(run().proposing).toBe(false);
    expect(run().proposeError).toBeNull();
  });

  it('a timeout failure clears proposing and shows the error', async () => {
    const h = boot();
    const proposer: ConjectureProposer = {
      hasKey: () => true,
      propose: async () => ({ ok: false, code: 'timeout', message: 'Anthropic did not answer', usage: null, prompt_sha256: null }),
    };
    useConjectureStore.getState().configure({ fs: h.fs, join: platformJoin, hash, now: () => NOW, proposer, openSession: async () => h.session });
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    expect(run().proposing).toBe(false);
    expect(run().proposeError?.code).toBe('timeout');
  });
});

describe('conjectureStore.propose', () => {
  it('adds drafts with proposer metadata and caches the kernel schema', async () => {
    boot();
    const res = await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    expect(res.ok).toBe(true);
    expect(run().proposals.map((p) => [p.conjecture.id, p.decision])).toEqual([['cj-t-1', 'draft'], ['cj-t-2', 'draft']]);
    expect(run().proposals[0].meta).toMatchObject({ model: 'claude-opus-5-5', prompt_sha256: 'f'.repeat(64) });
    expect(run().proposals[0].meta?.digest_disclosure).toContain('of 12');
    expect(useConjectureStore.getState().schema?.features.length).toBeGreaterThan(0);
    expect(run().proposing).toBe(false);
  });

  it('refuses without a key, with too few elites, or while the run is live', async () => {
    const h = boot();
    h.keyed.value = false;
    expect((await useConjectureStore.getState().propose(FRONTIER_RUN_ID)).ok).toBe(false);
    expect(run().proposeError?.code).toBe('no_key');
    h.keyed.value = true;
    useDiscoveryStore.setState({ liveRunIds: [FRONTIER_RUN_ID] });
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    expect(run().proposeError?.code).toBe('run_live');
    boot(undefined, 5);
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    expect(run().proposeError?.code).toBe('too_few_elites');
  });

  it('records proposer failures as typed errors', async () => {
    const h = boot();
    h.proposals[0] = { ok: false, code: 'http', message: 'overloaded', status: 529, usage: null, prompt_sha256: 'a' };
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    expect(run().proposeError).toEqual({ code: 'http', message: 'overloaded' });
    expect(run().proposals).toEqual([]);
  });
});

describe('conjectureStore.editDraft / decide', () => {
  it('validates edits against the kernel schema', async () => {
    boot();
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    const base = run().proposals[0].conjecture;
    const bad = useConjectureStore.getState().editDraft(FRONTIER_RUN_ID, 'cj-t-1', { ...base, circuits: 99 });
    expect(bad).toMatchObject({ ok: false });
    expect(!bad.ok && bad.issues?.[0].path).toBe('circuits');
    expect(run().proposals[0].edited).toBe(false);
    const good = useConjectureStore.getState().editDraft(FRONTIER_RUN_ID, 'cj-t-1', { ...base, circuits: 12 });
    expect(good.ok).toBe(true);
    expect(run().proposals[0]).toMatchObject({ edited: true, conjecture: { circuits: 12 } });
    useConjectureStore.getState().decide(FRONTIER_RUN_ID, 'cj-t-2', 'rejected');
    expect(run().proposals[1].decision).toBe('rejected');
  });
});

describe('conjectureStore.test', () => {
  it('streams evidence, finishes supported and writes the ledger', async () => {
    const h = boot(complete(fixtureResult('supported')));
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    const res = await useConjectureStore.getState().test(FRONTIER_RUN_ID, 'cj-t-1');
    expect(res.ok).toBe(true);
    const job = run().jobs['cj-t-1'];
    expect(job.status).toBe('complete');
    expect(job.evidence).toHaveLength(8);
    expect(job.evidence[0]).toMatchObject({ outcome: 'meets', betaUpper95: expect.any(Number) });
    expect(job.result?.verdict).toBe('supported');
    expect(run().proposals[0].decision).toBe('accepted');
    const ledger = JSON.parse(h.fs.files.get(LEDGER)!);
    expect(ledger.entries[0]).toMatchObject({ id: 'cj-t-1', outcome: 'complete', seed: job.seed });
    expect(ledger.entries[0].proposer.prompt_sha256).toBe('f'.repeat(64));
    expect(h.fs.files.get(LEDGER.replace('.json', '.md'))).toContain('cj-t-1: supported');
    expect(isConjectureTestActive(useConjectureStore.getState())).toBe(false);
  });

  it('keeps a refuted conjecture and its counterexample in the ledger', async () => {
    const h = boot(complete(fixtureResult('refuted')));
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    await useConjectureStore.getState().test(FRONTIER_RUN_ID, 'cj-t-1');
    expect(run().jobs['cj-t-1'].evidence.filter((e) => e.outcome === 'violates')).toHaveLength(1);
    const ledger = JSON.parse(h.fs.files.get(LEDGER)!);
    expect(ledger.entries[0].result.verdict).toBe('refuted');
    expect(ledger.entries[0].result.counterexamples).toHaveLength(1);
  });

  it('is active while running and cancels through the kernel', async () => {
    const h = boot((m, s) => {
      if (m.type === 'discovery_conjecture_test') s.emit({ type: 'discovery_conjecture_started', job_id: m.job_id });
      if (m.type === 'discovery_conjecture_cancel') {
        s.emit({ type: 'discovery_conjecture_cancelled', job_id: m.job_id, accepted: true });
        s.emit({ type: 'discovery_conjecture_result', job_id: m.job_id, status: 'cancelled', result: null });
      }
    });
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    const pending = useConjectureStore.getState().test(FRONTIER_RUN_ID, 'cj-t-1');
    await new Promise((r) => setTimeout(r, 0));
    expect(run().jobs['cj-t-1'].status).toBe('running');
    expect(isConjectureTestActive(useConjectureStore.getState())).toBe(true);
    await useConjectureStore.getState().cancel(FRONTIER_RUN_ID, 'cj-t-1');
    await pending;
    expect(run().jobs['cj-t-1'].status).toBe('cancelled');
    expect(h.fs.files.has(LEDGER)).toBe(false);
    expect(isConjectureTestActive(useConjectureStore.getState())).toBe(false);
  });

  it('surfaces kernel error envelopes on the job without touching the ledger', async () => {
    const h = boot((m, s) => {
      if (m.type === 'discovery_conjecture_test') s.emit({ type: 'error', phase: 'discovery', code: 'conjecture_busy', message: 'one at a time' });
    });
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    await useConjectureStore.getState().test(FRONTIER_RUN_ID, 'cj-t-1');
    expect(run().jobs['cj-t-1']).toMatchObject({ status: 'failed', error: { code: 'conjecture_busy' } });
    expect(h.fs.files.size).toBe(0);
  });

  it('records a kernel-reported failure as a failed ledger entry', async () => {
    const h = boot((m, s) => {
      if (m.type !== 'discovery_conjecture_test') return;
      s.emit({ type: 'discovery_conjecture_started', job_id: m.job_id });
      s.emit({ type: 'discovery_conjecture_result', job_id: m.job_id, status: 'failed', result: null });
    });
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    await useConjectureStore.getState().test(FRONTIER_RUN_ID, 'cj-t-1');
    expect(run().jobs['cj-t-1'].status).toBe('failed');
    expect(JSON.parse(h.fs.files.get(LEDGER)!).entries[0]).toMatchObject({ outcome: 'failed', result: null });
  });

  it('reports a ledger write failure without losing the result', async () => {
    const h = boot(complete(fixtureResult('supported')));
    h.fs.writeFile = async () => { throw new Error('read-only volume'); };
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    await useConjectureStore.getState().test(FRONTIER_RUN_ID, 'cj-t-1');
    expect(run().jobs['cj-t-1'].result?.verdict).toBe('supported');
    expect(run().jobs['cj-t-1'].ledgerError).toContain('read-only volume');
  });

  it('refuses to test a rejected proposal', async () => {
    boot();
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    useConjectureStore.getState().decide(FRONTIER_RUN_ID, 'cj-t-1', 'rejected');
    expect((await useConjectureStore.getState().test(FRONTIER_RUN_ID, 'cj-t-1')).ok).toBe(false);
  });
});

describe('conjectureStore ledger completeness (CR-M6)', () => {
  it('records a cancelled test that already holds a counterexample as a refutation', async () => {
    const refuted = { ...fixtureResult('refuted'), partial: true };
    const h = boot((m, s) => {
      if (m.type === 'discovery_conjecture_test') s.emit({ type: 'discovery_conjecture_started', job_id: m.job_id });
      if (m.type === 'discovery_conjecture_cancel') {
        s.emit({ type: 'discovery_conjecture_cancelled', job_id: m.job_id, accepted: true });
        s.emit({ type: 'discovery_conjecture_result', job_id: m.job_id, status: 'cancelled', result: refuted });
      }
    });
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    const pending = useConjectureStore.getState().test(FRONTIER_RUN_ID, 'cj-t-1');
    await new Promise((r) => setTimeout(r, 0));
    await useConjectureStore.getState().cancel(FRONTIER_RUN_ID, 'cj-t-1');
    await pending;
    const entry = JSON.parse(h.fs.files.get(LEDGER)!).entries[0];
    expect(entry).toMatchObject({ id: 'cj-t-1', outcome: 'complete' });
    expect(entry.result.verdict).toBe('refuted');
    expect(entry.result.counterexamples).toHaveLength(1);
    expect(run().jobs['cj-t-1'].status).toBe('cancelled');
    expect(run().jobs['cj-t-1'].result?.counterexamples).toHaveLength(1);
    expect(isConjectureTestActive(useConjectureStore.getState())).toBe(false);
  });

  it('reads the failure message from the top level of the result envelope', async () => {
    const h = boot((m, s) => {
      if (m.type !== 'discovery_conjecture_test') return;
      s.emit({ type: 'discovery_conjecture_started', job_id: m.job_id });
      s.emit({ type: 'discovery_conjecture_result', job_id: m.job_id, status: 'failed', result: null, error: { code: 'conjecture_internal', message: 'Pauli propagation ran out of memory' } });
    });
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    await useConjectureStore.getState().test(FRONTIER_RUN_ID, 'cj-t-1');
    expect(run().jobs['cj-t-1']).toMatchObject({ status: 'failed', error: { code: 'conjecture_internal', message: 'Pauli propagation ran out of memory' } });
    expect(JSON.parse(h.fs.files.get(LEDGER)!).entries[0]).toMatchObject({ outcome: 'failed', error: 'Pauli propagation ran out of memory' });
  });

  it('never leaves a job running when its proposal is gone: the ledger entry uses the snapshot', async () => {
    let finish: (() => void) | null = null;
    const h = boot((m, s) => {
      if (m.type !== 'discovery_conjecture_test') return;
      s.emit({ type: 'discovery_conjecture_started', job_id: m.job_id });
      finish = () => s.emit({ type: 'discovery_conjecture_result', job_id: m.job_id, status: 'complete', result: fixtureResult('supported') });
    });
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    const pending = useConjectureStore.getState().test(FRONTIER_RUN_ID, 'cj-t-1');
    await new Promise((r) => setTimeout(r, 0));
    useConjectureStore.setState((s) => ({ byRun: { ...s.byRun, [FRONTIER_RUN_ID]: { ...s.byRun[FRONTIER_RUN_ID], proposals: [] } } }));
    finish?.();
    await pending;
    expect(run().jobs['cj-t-1'].status).toBe('complete');
    expect(JSON.parse(h.fs.files.get(LEDGER)!).entries[0]).toMatchObject({ id: 'cj-t-1', outcome: 'complete' });
  });

  it('caps the proposals kept per run but never drops one with a test job', async () => {
    const h = boot();
    h.proposals[0] = {
      ok: true, conjectures: Array.from({ length: 5 }, (_, i) => fixtureConjecture({ id: `cj-n-${i}` })),
      dropped: [], model: 'claude-opus-5-5', usage: USAGE, prompt_sha256: 'f'.repeat(64),
    };
    for (let i = 0; i < 12; i += 1) await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    expect(run().proposals.length).toBe(50);
  });
});

describe('conjectureStore.testAll / ledger / counterexample', () => {
  it('tests accepted proposals one after another and accumulates the ledger', async () => {
    const h = boot((m, s) => complete(m.type === 'discovery_conjecture_test' && m.conjecture.id === 'cj-t-2' ? fixtureResult('inconclusive') : fixtureResult('supported'))(m, s));
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    expect((await useConjectureStore.getState().testAll(FRONTIER_RUN_ID)).ok).toBe(false);
    useConjectureStore.getState().decide(FRONTIER_RUN_ID, 'cj-t-1', 'accepted');
    useConjectureStore.getState().decide(FRONTIER_RUN_ID, 'cj-t-2', 'accepted');
    const res = await useConjectureStore.getState().testAll(FRONTIER_RUN_ID);
    expect(res).toMatchObject({ ok: true, started: 2 });
    const entries = JSON.parse(h.fs.files.get(LEDGER)!).entries;
    expect(entries.map((e: { id: string }) => e.id).sort()).toEqual(['cj-t-1', 'cj-t-2']);
    expect(run().jobs['cj-t-2'].result?.verdict).toBe('inconclusive');
  });

  it('reloads the ledger from disk and reports a corrupt file', async () => {
    const h = boot(complete(fixtureResult('refuted')));
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    await useConjectureStore.getState().test(FRONTIER_RUN_ID, 'cj-t-1');
    useConjectureStore.getState().reset();
    useConjectureStore.getState().configure({ fs: h.fs, join: platformJoin, hash, now: () => NOW, proposer: { hasKey: () => true, propose: async () => h.proposals[0] }, openSession: async () => h.session });
    await useConjectureStore.getState().reloadLedger(FRONTIER_RUN_ID);
    expect(run().ledger.ledger?.entries[0].result?.verdict).toBe('refuted');
    h.fs.files.set(LEDGER, '{broken');
    await useConjectureStore.getState().reloadLedger(FRONTIER_RUN_ID);
    expect(run().ledger.error).toContain('not valid JSON');
  });

  it('writes a counterexample as a Qiskit program into the run folder', async () => {
    const h = boot(complete(fixtureResult('refuted')));
    await useConjectureStore.getState().propose(FRONTIER_RUN_ID);
    await useConjectureStore.getState().test(FRONTIER_RUN_ID, 'cj-t-1');
    const res = await useConjectureStore.getState().writeCounterexample(FRONTIER_RUN_ID, 'cj-t-1', 0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toBe('/proj/experiments/w-state-synthesis/discovery/' + FRONTIER_RUN_ID + '/counterexamples/cj-t-1-cx1.py');
    expect(h.fs.files.get(res.path)).toContain('from qiskit import QuantumCircuit');
    expect((await useConjectureStore.getState().writeCounterexample(FRONTIER_RUN_ID, 'cj-t-1', 5)).ok).toBe(false);
  });
});
