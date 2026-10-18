/**
 * Test doubles for the Discovery Engine: a toy evaluator, a fake kernel
 * session, a fake LLM, an in-memory fs and a manual clock. Test-only.
 */

import type {
  AstMutation,
  DiscoveryAudit,
  DiscoveryEvaluation,
  DiscoveryEvaluatorInfo,
  DiscoverySpec,
  DiscoveryStage,
} from '../../types/discovery';
import { discoverySpecSchema } from '../../types/discovery';
import type { KernelMessage, KernelResponse } from '../../types/quantum';
import type { DiscoveryLlm, LlmResult, ProposeInput } from './llmMutator';
import type { DiscoveryFs } from './records';
import type { DiscoveryDeps, RunnerClock } from './runContext';

export const SEED_PROGRAM = [
  'import q',
  '# EVOLVE-BLOCK-START',
  'IMPROVE = 0',
  '# EVOLVE-BLOCK-END',
  'def build():',
  '    return IMPROVE',
  '',
].join('\n');

export const TOY_EVALUATOR: DiscoveryEvaluatorInfo = {
  kind: 'state_synthesis',
  version: '1.0.0',
  title: 'Toy evaluator',
  description: 'Scores the IMPROVE constant.',
  task: 'quantum_circuit',
  entry_signature: 'build() -> int',
  objectives: [
    { key: 'err', label: 'Error', direction: 'minimize' },
    { key: 'cost', label: 'Cost', direction: 'minimize' },
  ],
  descriptors: [
    { key: 'd1', label: 'Lines', min: 0, max: 10, default_bins: 4 },
    { key: 'd2', label: 'Value', min: 0, max: 100, default_bins: 4 },
  ],
  config_schema: {},
  default_config: {},
};

export function makeSpec(overrides: Record<string, unknown> = {}): DiscoverySpec {
  return discoverySpecSchema.parse({
    schema: 1,
    type: 'discovery',
    name: 'toy',
    program: 'discovery/toy.py',
    evaluator: { kind: 'state_synthesis', config: {} },
    search: { islands: 2, generations: 3, candidates_per_generation: 3, migration_interval: 0, early_stop_patience: 0, exploration: 0 },
    evaluation: { cascade: false },
    mutator: { kind: 'ast' },
    budget: { max_evaluations: 100, max_llm_calls: 100, max_wall_minutes: 60, max_concurrent_evaluations: 2 },
    confirm: { seeds: 2 },
    seed: 3,
    ...overrides,
  });
}

export function improveValue(program: string): number {
  const m = /IMPROVE = (-?\d+)/.exec(program);
  return m ? Number(m[1]) : NaN;
}

export function makeEvaluation(patch: Partial<DiscoveryEvaluation> = {}): DiscoveryEvaluation {
  return {
    candidate_id: 'c-0000',
    run_id: 'r',
    status: 'scored',
    fitness: 1,
    objectives: { err: { value: 0.1, direction: 'minimize', label: 'Error' }, cost: { value: 5, direction: 'minimize', label: 'Cost' } },
    descriptors: { d1: 2, d2: 10 },
    metrics: {},
    guardrails: [],
    rejection: null,
    failure: null,
    stdout: '',
    stderr: '',
    timings_ms: { total: 1 },
    evaluator: { kind: 'state_synthesis', version: '1.0.0', fingerprint: 'f'.repeat(64) },
    seed: 1,
    stage: 'full',
    ...patch,
  };
}

export function makeAudit(patch: Partial<DiscoveryAudit> = {}): DiscoveryAudit {
  return {
    verdict: 'consistent',
    evaluator_fitness: 1,
    audit_fitness: 1,
    gap: 0,
    checks: [{ id: 'reparse', label: 'Re-parse from scratch', status: 'pass', detail: null }],
    reasons: [],
    evaluator: { kind: 'state_synthesis', version: '1.0.0', fingerprint: 'f'.repeat(64) },
    audit_fingerprint: 'a'.repeat(64),
    seed: 99,
    isolation: 'process',
    timings_ms: { sandbox: 2, audit: 5, total: 8 },
    notes: null,
    ...patch,
  };
}

export type AuditMessage = Extract<KernelMessage, { type: 'discovery_audit' }>;
export type Auditor = (message: AuditMessage) => Partial<DiscoveryAudit>;

export type Scorer = (program: string, stage: DiscoveryStage, seed: number, id: string) => Partial<DiscoveryEvaluation>;

export const defaultScorer: Scorer = (program, stage, seed) => {
  const value = improveValue(program);
  if (Number.isNaN(value)) {
    return { status: 'rejected', fitness: null, rejection: { guardrail: 'parse', message: 'no IMPROVE constant' } };
  }
  // Screen estimates are noisier (wider interval), as in the real cascade.
  const err = Math.pow(10, -value);
  const spread = stage === 'screen' ? 8 : 2;
  return {
    fitness: value + (stage === 'confirm' ? ((seed % 5) - 2) * 0.01 : 0),
    objectives: {
      err: { value: err, ci95: [err / spread, err * spread], direction: 'minimize', label: 'Error' },
      cost: { value: program.split('\n').length, direction: 'minimize', label: 'Cost' },
    },
    descriptors: { d1: program.split('\n').length, d2: Math.max(0, value) },
    program_key: `key:${value}`,
  };
};

export interface FakeKernel {
  session: DiscoveryDeps['session'];
  sent: KernelMessage[];
  /** Hold replies until `release()`; used to test pause, stop and concurrency. */
  hold: { value: boolean };
  release(): void;
  inFlight(): number;
  maxInFlight(): number;
  /** Hold audit replies until `releaseAudits()`. */
  holdAudits: { value: boolean };
  releaseAudits(): void;
  /** Peak of evaluations and audits in flight together. */
  maxTotalInFlight(): number;
  audits(): AuditMessage[];
}

export interface FakeKernelOptions {
  scorer?: Scorer;
  latencyMs?: number;
  mutate?: (program: string, seed: number) => AstMutation[];
  /** Answers `discovery_audit`; default is a consistent verdict. */
  auditor?: Auditor;
  /** Answers `discovery_program_key`; without it the fake behaves like an older kernel (`invalid_request`). */
  programKey?: (program: string) => string;
  /** Echo `request_id` on sync replies like a current kernel (default true). */
  echoRequestIds?: boolean;
}

export function createFakeKernel(options: FakeKernelOptions = {}): FakeKernel {
  const scorer = options.scorer ?? defaultScorer;
  const handlers = new Set<(m: KernelResponse) => void>();
  const sent: KernelMessage[] = [];
  const held: Array<() => void> = [];
  const hold = { value: false };
  let active = 0;
  let peak = 0;
  let auditActive = 0;
  let totalPeak = 0;
  const heldAudits: Array<() => void> = [];
  const holdAudits = { value: false };
  const cancelledAudits = new Set<string>();
  const cancelled = new Set<string>();
  const emit = (m: KernelResponse) => handlers.forEach((h) => h(m));
  const mutate =
    options.mutate ??
    ((program: string, seed: number): AstMutation[] => {
      const next = improveValue(program) + (seed % 3 === 0 ? 0 : seed % 3);
      return [{ program: program.replace(/IMPROVE = -?\d+/, `IMPROVE = ${next}`), operators: ['perturb_constant'], description: 'x' }];
    });

  const respond = (message: Extract<KernelMessage, { type: 'discovery_evaluate' }>) => {
    active += 1;
    peak = Math.max(peak, active);
    totalPeak = Math.max(totalPeak, active + auditActive);
    const reply = () => {
      active -= 1;
      const key = `${message.run_id}/${message.candidate_id}`;
      const wasCancelled = cancelled.has(message.run_id);
      const partial: Partial<DiscoveryEvaluation> = wasCancelled
        ? { status: 'failed', fitness: null, failure: { stage: 'sandbox', code: 'cancelled', message: 'cancelled' } }
        : scorer(message.program, message.stage ?? 'full', message.seed, message.candidate_id);
      void key;
      emit({
        type: 'discovery_evaluation',
        run_id: message.run_id,
        candidate_id: message.candidate_id,
        evaluation: makeEvaluation({ candidate_id: message.candidate_id, run_id: message.run_id, seed: message.seed, stage: message.stage ?? 'full', ...partial }),
      });
    };
    if (hold.value) held.push(reply);
    else setTimeout(reply, options.latencyMs ?? 0);
  };

  const respondAudit = (message: AuditMessage) => {
    auditActive += 1;
    totalPeak = Math.max(totalPeak, active + auditActive);
    setTimeout(() => emit({ type: 'discovery_audit_accepted', run_id: message.run_id, candidate_id: message.candidate_id, queue_position: 0 }), 0);
    const reply = () => {
      auditActive -= 1;
      if (cancelledAudits.has(message.run_id)) return;
      const partial = (options.auditor ?? (() => ({})))(message);
      emit({ type: 'discovery_audit_result', run_id: message.run_id, candidate_id: message.candidate_id, audit: makeAudit({ seed: message.seed, evaluator_fitness: message.evaluation.fitness, ...partial }) });
    };
    if (holdAudits.value) heldAudits.push(reply);
    else setTimeout(reply, options.latencyMs ?? 0);
  };

  const echo = (request_id: string | undefined) => (options.echoRequestIds === false || request_id === undefined ? {} : { request_id });
  const session: FakeKernel['session'] = {
    send(message: KernelMessage) {
      sent.push(message);
      if (message.type === 'discovery_evaluators') {
        setTimeout(() => emit({ type: 'discovery_evaluators_result', evaluators: [TOY_EVALUATOR], ...echo(message.request_id) }), 0);
      } else if (message.type === 'discovery_evaluate') respond(message);
      else if (message.type === 'discovery_mutate') {
        const mutations = mutate(message.program, message.seed);
        setTimeout(() => emit({ type: 'discovery_mutations', mutations, ...echo(message.request_id) }), 0);
      } else if (message.type === 'discovery_program_key') {
        const keyOf = options.programKey;
        setTimeout(() => emit(keyOf
          ? { type: 'discovery_program_key_result', program_key: keyOf(message.program), ...echo(message.request_id) }
          : { type: 'error', phase: 'discovery', code: 'invalid_request', message: 'Unknown discovery message', ...echo(message.request_id) }), 0);
      } else if (message.type === 'discovery_audit') respondAudit(message);
      else if (message.type === 'discovery_audit_cancel') {
        cancelledAudits.add(message.run_id);
        heldAudits.splice(0).forEach((reply) => reply());
        setTimeout(() => emit({ type: 'discovery_audit_cancelled', run_id: message.run_id, candidate_id: message.candidate_id ?? null, cancelled: 1 }), 0);
      } else if (message.type === 'discovery_cancel') {
        cancelled.add(message.run_id);
        held.splice(0).forEach((reply) => reply());
      }
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
  return {
    session,
    sent,
    hold,
    release: () => {
      hold.value = false;
      held.splice(0).forEach((reply) => reply());
    },
    inFlight: () => active,
    maxInFlight: () => peak,
    holdAudits,
    releaseAudits: () => {
      holdAudits.value = false;
      heldAudits.splice(0).forEach((reply) => reply());
    },
    maxTotalInFlight: () => totalPeak,
    audits: () => sent.filter((m): m is AuditMessage => m.type === 'discovery_audit'),
  };
}

export interface FakeLlm extends DiscoveryLlm {
  calls: ProposeInput[];
  batchSubmits: string[][];
  key: { value: boolean };
  batchState: { polls: number; endAfter: number };
}

export function createFakeLlm(options: { edit?: (parent: number, call: number) => { search: string; replace: string }[] } = {}): FakeLlm {
  const calls: ProposeInput[] = [];
  const key = { value: true };
  const batchSubmits: string[][] = [];
  const batchState = { polls: 0, endAfter: 1 };
  const parentOf = (user: string) => improveValue(/## Parent program[\s\S]*?```python\n([\s\S]*?)```/.exec(user)?.[1] ?? '');
  const result = (input: ProposeInput, n: number): LlmResult => {
    const parent = parentOf(input.user);
    const edits = options.edit?.(parent, n) ?? [{ search: `IMPROVE = ${parent}`, replace: `IMPROVE = ${parent + 2}` }];
    return {
      ok: true,
      proposal: { rationale: 'raise it', expected_effect: 'err down', edits },
      model: 'm', thinking: false, prompt_sha256: `sha-${n}`,
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 },
    };
  };
  const pendingBatch = new Map<string, Array<{ customId: string; input: ProposeInput }>>();
  return {
    calls, batchSubmits, key, batchState,
    hasKey: () => key.value,
    async propose(input) {
      calls.push(input);
      return result(input, calls.length);
    },
    async submitBatch(items) {
      const id = `batch-${batchSubmits.length + 1}`;
      batchSubmits.push(items.map((i) => i.customId));
      pendingBatch.set(id, items);
      return { ok: true, batchId: id };
    },
    async pollBatch() {
      batchState.polls += 1;
      return batchState.polls >= batchState.endAfter ? { state: 'ended' } : { state: 'in_progress' };
    },
    async batchResults(id) {
      const items = pendingBatch.get(id) ?? [];
      return Object.fromEntries(items.map((i, n) => [i.customId, result(i.input, n + 1)]));
    },
  };
}

export function createMemoryFs(initial: Record<string, string> = {}): DiscoveryFs & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  const dirs = new Set<string>();
  return {
    files,
    async mkdir(path) { dirs.add(path); },
    async writeFile(path, content) { files.set(path, content); },
    async readFile(path) { return files.get(path) ?? null; },
    async exists(path) {
      return files.has(path) || dirs.has(path) || [...files.keys()].some((f) => f.startsWith(`${path}/`));
    },
    async readDir(path) {
      const prefix = `${path.replace(/\/$/, '')}/`;
      const seen = new Map<string, boolean>();
      for (const f of files.keys()) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        const [head, ...tail] = rest.split('/');
        seen.set(head, tail.length > 0);
      }
      return [...seen].map(([name, isDirectory]) => ({ name, isDirectory }));
    },
  };
}

export function createManualClock(startMs = Date.UTC(2026, 9, 18, 14, 15, 30)): RunnerClock & { advance(ms: number): void; sleeps: number[] } {
  let t = startMs;
  const sleeps: number[] = [];
  return {
    now: () => new Date(t),
    sleep: async (ms) => { sleeps.push(ms); t += ms; await new Promise((r) => setTimeout(r, 0)); },
    advance: (ms) => { t += ms; },
    sleeps,
  };
}

export const joinPath = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');

export async function testHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
