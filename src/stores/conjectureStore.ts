/**
 * PRD 14 Conjecture Engine store. It owns proposals, test jobs and ledger
 * state per Discovery run, and the dedicated kernel session, so a test keeps
 * streaming after the panel unmounts. Run data is read from `useDiscoveryStore`
 * (never written). Handles live in module-level registries, not React state.
 */

import { create } from 'zustand';
import type { Conjecture, ConjectureSchemaInfo, LedgerEntry, ProposerMeta } from '../types/conjecture';
import { MIN_SCORED_ELITES, buildDigest } from '../services/conjecture/digest';
import type { ConjectureEnv } from '../services/conjecture/env';
import { normalizeEvidence } from '../services/conjecture/evidence';
import { ledgerPaths, loadLedger, renderLedgerMarkdown, saveLedger, upsertEntry } from '../services/conjecture/ledger';
import { irToQiskitProgram } from '../services/conjecture/qiskitExport';
import type { SchemaIssue } from '../services/conjecture/jsonSchema';
import {
  isActiveJob,
  patchJob,
  patchProposal,
  patchRun,
  proposeBlocker,
  type RunConjectures,
  type TestJob,
} from '../services/conjecture/state';
import { createConjectureTester, type ConjectureTester, type TestEnd, type TestHandle } from '../services/conjecture/tester';
import { timestampSlug } from '../services/discovery/records';
import { useDiscoveryStore } from './discoveryStore';
import { validateConjecture } from '../services/conjecture/validate';

export type ActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string; issues?: SchemaIssue[] };

export interface ConjectureState {
  byRun: Record<string, RunConjectures>;
  schema: ConjectureSchemaInfo | null;
  schemaError: string | null;

  configure(env: ConjectureEnv | null): void;
  propose(runId: string): Promise<ActionResult>;
  editDraft(runId: string, conjectureId: string, next: Conjecture): ActionResult;
  decide(runId: string, conjectureId: string, decision: 'draft' | 'accepted' | 'rejected'): void;
  test(runId: string, conjectureId: string): Promise<ActionResult>;
  cancel(runId: string, conjectureId: string): Promise<void>;
  testAll(runId: string): Promise<ActionResult<{ started: number }>>;
  reloadLedger(runId: string): Promise<void>;
  /** Read the ledger markdown (rendered from memory when the file is not on disk yet). */
  readLedgerMarkdown(runId: string): Promise<ActionResult<{ path: string; content: string }>>;
  /** Write a counterexample as a Qiskit program into the run folder; returns its absolute path and text. */
  writeCounterexample(runId: string, conjectureId: string, index: number): Promise<ActionResult<{ path: string; code: string }>>;
  reset(): void;
}

// ── Module-level registries (not React state) ──────────────────────────

let env: ConjectureEnv | null = null;
let tester: ConjectureTester | null = null;
const handles = new Map<string, TestHandle>();
let queue: Promise<unknown> = Promise.resolve();

const fail = (error: string, issues?: SchemaIssue[]): { ok: false; error: string; issues?: SchemaIssue[] } => ({ ok: false, error, ...(issues ? { issues } : {}) });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const jobKey = (runId: string, id: string) => `${runId}:${id}`;

function needEnv(): ConjectureEnv {
  if (!env) throw new Error('The Conjecture Engine is not configured for this platform.');
  return env;
}

async function ensureTester(): Promise<ConjectureTester> {
  if (tester && !tester.closed) return tester;
  const session = await needEnv().openSession();
  tester = createConjectureTester(session);
  return tester;
}

function runContext(runId: string) {
  const d = useDiscoveryStore.getState();
  const view = d.views[runId];
  if (!view || !d.projectRoot) return null;
  return { view, projectRoot: d.projectRoot, live: d.liveRunIds.includes(runId) };
}

async function seedFor(conjecture: Conjecture): Promise<number> {
  const digest = await needEnv().hash(JSON.stringify(conjecture));
  return Number.parseInt(digest.slice(0, 8), 16);
}

export function isConjectureTestActive(state: Pick<ConjectureState, 'byRun'>): boolean {
  return Object.values(state.byRun).some((run) => Object.values(run.jobs).some(isActiveJob));
}

const initial = { byRun: {} as Record<string, RunConjectures>, schema: null as ConjectureSchemaInfo | null, schemaError: null as string | null };

export const useConjectureStore = create<ConjectureState>()((set, get) => {
  const update = (runId: string, patch: (c: RunConjectures) => Partial<RunConjectures>) =>
    set((s) => ({ byRun: patchRun(s.byRun, runId, patch) }));

  async function ensureSchema(): Promise<ConjectureSchemaInfo | { error: string }> {
    const known = get().schema;
    if (known) return known;
    try {
      const t = await ensureTester();
      const res = await t.schema();
      if (!res.ok) {
        set({ schemaError: res.error.message });
        return { error: res.error.message };
      }
      set({ schema: res.value, schemaError: null });
      return res.value;
    } catch (e) {
      const error = message(e);
      set({ schemaError: error });
      return { error };
    }
  }

  async function recordEntry(runId: string, entry: LedgerEntry): Promise<string | null> {
    const ctx = runContext(runId);
    if (!ctx) return 'The run is no longer loaded, so the ledger was not written.';
    const e = needEnv();
    const paths = ledgerPaths(e.join, ctx.projectRoot, ctx.view.run.definition_file, runId);
    const now = e.now().toISOString();
    let ledger = get().byRun[runId]?.ledger.ledger ?? null;
    if (!ledger) {
      const loaded = await loadLedger(e.fs, paths, runId, now);
      if (!loaded.ok) {
        update(runId, (c) => ({ ledger: { ...c.ledger, error: loaded.error } }));
        return loaded.error;
      }
      ledger = loaded.ledger;
    }
    const next = upsertEntry(ledger, entry, now);
    const saved = await saveLedger(e.fs, paths, next);
    update(runId, () => ({ ledger: { ledger: next, loading: false, error: saved.ok ? null : saved.error } }));
    return saved.ok ? null : saved.error;
  }

  async function finishJob(runId: string, conjectureId: string, end: TestEnd, seed: number): Promise<void> {
    handles.delete(jobKey(runId, conjectureId));
    if (end.kind === 'result') {
      const result = end.result;
      if (end.status === 'cancelled') {
        set((s) => ({ byRun: patchJob(s.byRun, runId, conjectureId, () => ({ status: 'cancelled', result, fraction: 1 })) }));
        return;
      }
      const proposal = get().byRun[runId]?.proposals.find((p) => p.conjecture.id === conjectureId);
      if (proposal) {
        const failed = end.status === 'failed' || !result;
        const entry: LedgerEntry = {
          id: conjectureId,
          conjecture: proposal.conjecture,
          proposer: proposal.meta,
          outcome: failed ? 'failed' : 'complete',
          result: result ?? null,
          error: failed ? (result?.error?.message ?? result?.summary ?? 'The kernel reported the test failed.') : null,
          seed,
          tested_at: needEnv().now().toISOString(),
        };
        const ledgerError = await recordEntry(runId, entry);
        set((s) => ({
          byRun: patchJob(s.byRun, runId, conjectureId, () => ({
            status: failed ? 'failed' : 'complete',
            result,
            fraction: 1,
            error: failed ? { code: 'test_failed', message: entry.error ?? '' } : null,
            ledgerError,
          })),
        }));
      }
      return;
    }
    const error = end.kind === 'error' ? end.error : { code: 'disconnected', message: 'The kernel connection closed during the test.' };
    set((s) => ({ byRun: patchJob(s.byRun, runId, conjectureId, () => ({ status: 'failed', error })) }));
  }

  return {
    ...initial,

    configure(next) {
      env = next;
    },

    async propose(runId) {
      const ctx = runContext(runId);
      if (!ctx) return fail('That run is not loaded.');
      let e: ConjectureEnv;
      try {
        e = needEnv();
      } catch (err) {
        return fail(message(err));
      }
      const digest = buildDigest({ run: ctx.view.run, candidates: ctx.view.candidates });
      const blocked = proposeBlocker({ hasKey: e.proposer.hasKey(), scoredElites: digest.scoredElites, live: ctx.live, minElites: MIN_SCORED_ELITES });
      if (blocked) {
        update(runId, () => ({ proposeError: { code: blocked.code, message: blocked.reason } }));
        return fail(blocked.reason);
      }
      if (get().byRun[runId]?.proposing) return fail('Already proposing.');
      update(runId, () => ({ proposing: true, proposeError: null, dropped: [] }));
      const schema = await ensureSchema();
      if ('error' in schema) {
        const text = `Could not read the kernel's conjecture schema: ${schema.error}`;
        update(runId, () => ({ proposing: false, proposeError: { code: 'no_schema', message: text } }));
        return fail(text);
      }
      const proposedAt = e.now();
      const res = await e.proposer.propose({ digest, schema, idPrefix: `cj-${timestampSlug(proposedAt)}` });
      if (!res.ok) {
        update(runId, () => ({ proposing: false, proposeError: { code: res.code, message: res.message }, dropped: res.dropped ?? [] }));
        return fail(res.message);
      }
      const meta: ProposerMeta = {
        model: res.model,
        prompt_sha256: res.prompt_sha256,
        usage: res.usage,
        proposed_at: proposedAt.toISOString(),
        digest_disclosure: digest.disclosure,
      };
      update(runId, (c) => ({
        proposing: false,
        dropped: res.dropped,
        proposals: [...res.conjectures.map((conjecture) => ({ conjecture, decision: 'draft' as const, meta, edited: false })), ...c.proposals],
      }));
      return { ok: true };
    },

    editDraft(runId, conjectureId, next) {
      const schema = get().schema;
      const current = get().byRun[runId]?.proposals.find((p) => p.conjecture.id === conjectureId);
      if (!schema || !current) return fail('That proposal is not available to edit.');
      if (isActiveJob(get().byRun[runId]?.jobs[conjectureId])) return fail('Cancel the running test before editing.');
      const checked = validateConjecture({ ...next, id: conjectureId }, schema);
      if (!checked.ok) return fail('The edited conjecture does not match the kernel schema.', checked.issues);
      update(runId, (c) => ({
        proposals: patchProposal(c.proposals, conjectureId, { conjecture: checked.conjecture, edited: true, decision: 'draft' }),
        jobs: Object.fromEntries(Object.entries(c.jobs).filter(([id]) => id !== conjectureId)),
      }));
      return { ok: true };
    },

    decide(runId, conjectureId, decision) {
      update(runId, (c) => ({ proposals: patchProposal(c.proposals, conjectureId, { decision }) }));
    },

    async test(runId, conjectureId) {
      const run = get().byRun[runId];
      const proposal = run?.proposals.find((p) => p.conjecture.id === conjectureId);
      if (!proposal) return fail('That proposal is not available.');
      if (proposal.decision === 'rejected') return fail('Restore the rejected proposal before testing it.');
      if (isActiveJob(run?.jobs[conjectureId])) return fail('That conjecture is already being tested.');
      let seed: number;
      let t: ConjectureTester;
      try {
        seed = await seedFor(proposal.conjecture);
        t = await ensureTester();
      } catch (err) {
        return fail(message(err));
      }
      const job: TestJob = {
        jobId: '', conjectureId, status: 'starting', fraction: 0, message: 'Starting', circuitIndex: null,
        evidence: [], result: null, error: null, seed, startedAt: needEnv().now().toISOString(), ledgerError: null,
      };
      update(runId, (c) => ({
        proposals: patchProposal(c.proposals, conjectureId, { decision: 'accepted' }),
        jobs: { ...c.jobs, [conjectureId]: job },
      }));
      const handle = t.start({ conjecture: proposal.conjecture, seed }, (event) => {
        set((s) => ({
          byRun: patchJob(s.byRun, runId, conjectureId, (j) => {
            if (j.status === 'cancelling') return event.kind === 'evidence' ? { evidence: [...j.evidence, normalizeEvidence(event.item, j.evidence.length)] } : {};
            if (event.kind === 'started') return { status: 'running' as const, message: 'Running' };
            if (event.kind === 'progress') return { status: 'running' as const, fraction: event.fraction, message: event.message, circuitIndex: event.circuitIndex };
            return { evidence: [...j.evidence, normalizeEvidence(event.item, j.evidence.length)] };
          }),
        }));
      });
      handles.set(jobKey(runId, conjectureId), handle);
      set((s) => ({ byRun: patchJob(s.byRun, runId, conjectureId, () => ({ jobId: handle.jobId })) }));
      await finishJob(runId, conjectureId, await handle.done, seed);
      return { ok: true };
    },

    async cancel(runId, conjectureId) {
      const handle = handles.get(jobKey(runId, conjectureId));
      if (!handle) return;
      set((s) => ({ byRun: patchJob(s.byRun, runId, conjectureId, (j) => (isActiveJob(j) ? { status: 'cancelling' as const, message: 'Cancelling' } : {})) }));
      await handle.cancel();
    },

    async testAll(runId) {
      const run = get().byRun[runId];
      const ids = (run?.proposals ?? [])
        .filter((p) => p.decision === 'accepted' && !run?.jobs[p.conjecture.id])
        .map((p) => p.conjecture.id);
      if (ids.length === 0) return fail('Accept at least one untested proposal first.');
      const batch = queue.then(async () => {
        for (const id of ids) {
          const job = get().byRun[runId]?.jobs[id];
          if (job) continue;
          const res = await get().test(runId, id);
          const after = get().byRun[runId]?.jobs[id];
          if (!res.ok || after?.status === 'cancelled' || after?.error?.code === 'disconnected') break;
        }
      });
      queue = batch.catch(() => undefined);
      await batch;
      return { ok: true, started: ids.length };
    },

    async reloadLedger(runId) {
      const ctx = runContext(runId);
      if (!ctx || !env) return;
      update(runId, (c) => ({ ledger: { ...c.ledger, loading: true } }));
      const paths = ledgerPaths(env.join, ctx.projectRoot, ctx.view.run.definition_file, runId);
      const loaded = await loadLedger(env.fs, paths, runId, env.now().toISOString());
      update(runId, (c) => ({
        ledger: loaded.ok ? { ledger: loaded.ledger, loading: false, error: null } : { ledger: c.ledger.ledger, loading: false, error: loaded.error },
      }));
    },

    async readLedgerMarkdown(runId) {
      const ctx = runContext(runId);
      const ledger = get().byRun[runId]?.ledger.ledger;
      if (!ctx || !env) return fail('That run is not loaded.');
      const path = ledgerPaths(env.join, ctx.projectRoot, ctx.view.run.definition_file, runId).md;
      try {
        const onDisk = await env.fs.readFile(path);
        if (onDisk !== null) return { ok: true, path, content: onDisk };
      } catch (err) {
        return fail(`Could not read the ledger: ${message(err)}`);
      }
      return ledger ? { ok: true, path, content: renderLedgerMarkdown(ledger) } : fail('The ledger is empty. Test a conjecture first.');
    },

    async writeCounterexample(runId, conjectureId, index) {
      const ctx = runContext(runId);
      const entry = get().byRun[runId]?.jobs[conjectureId]?.result ?? get().byRun[runId]?.ledger.ledger?.entries.find((x) => x.id === conjectureId)?.result;
      const cx = entry?.counterexamples[index];
      if (!ctx || !env || !cx) return fail('That counterexample is not available.');
      const conjecture = get().byRun[runId]?.proposals.find((p) => p.conjecture.id === conjectureId)?.conjecture
        ?? get().byRun[runId]?.ledger.ledger?.entries.find((x) => x.id === conjectureId)?.conjecture;
      const program = irToQiskitProgram(cx.ir, { conjectureId, statement: conjecture?.statement ?? '', seed: cx.regenerate.seed, familyParams: cx.family_params });
      if (!program.ok) return fail(program.error);
      try {
        const dir = env.join(ledgerPaths(env.join, ctx.projectRoot, ctx.view.run.definition_file, runId).dir, 'counterexamples');
        const path = env.join(dir, `${conjectureId}-cx${index + 1}.py`);
        await env.fs.mkdir(dir, { recursive: true });
        await env.fs.writeFile(path, program.code);
        return { ok: true, path, code: program.code };
      } catch (err) {
        return fail(`Could not write the counterexample file: ${message(err)}`);
      }
    },

    reset() {
      for (const handle of handles.values()) void handle.cancel();
      handles.clear();
      tester?.close();
      tester = null;
      queue = Promise.resolve();
      set({ ...initial });
    },
  };
});
