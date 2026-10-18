/**
 * The Discovery Engine runner (PRD 14 §7.4): `runDiscovery(spec, ctx, deps, opts)`.
 *
 * One run = a seed evaluation, then up to `generations` generations. Each
 * generation plans its proposals synchronously from a frozen copy of the
 * archive (all RNG draws happen up front, so plans are deterministic), then
 * produces and evaluates them concurrently, then integrates the results in
 * id order. Budgets are checked before every proposal. Every state change is
 * persisted through the injected fs; `resumeRunId` continues from disk.
 *
 * Dedup decision: the runner dedups on the SHA-256 of the program text
 * client-side (free, catches byte-identical proposals) and records the
 * kernel's AST-normalized `program_key` from each evaluation, marking later
 * candidates with a known key as `duplicate`. The key itself is computed
 * kernel-side only.
 */

import {
  type ArchiveAxis,
  type CandidateRecord,
  type DiscoveryEvaluation,
  type DiscoveryEvaluatorInfo,
  type DiscoverySpec,
  type RunRecord,
  type RunStatus,
  type StopReason,
} from '../../types/discovery';
import { bestElite, createArchive, eliteFromEvaluation, axisFromDescriptor, insertElite } from './archive';
import { findRegion } from './diff';
import { createAuditClient, type AuditClient } from './kernelAudit';
import { createKernelEvaluator, isTransportFailure, type KernelEvaluator } from './kernelEval';
import { auditIfDue, observeSeed, pendingAudits, rebuildRedQueen, runAudit } from './auditStep';
import { EMPTY_POLICY, NO_EXPLOIT_MESSAGE, isRedQueen, redQueenConfig } from './redQueen';
import { buildRedQueenSystemPrompt } from './redQueenPrompt';
import { awaitBatch, submitBatch } from './batch';
import { confirmChampion } from './confirmation';
import { buildSystemPrompt } from './prompt';
import { emptyUsage, exhaustedBudget, llmBudgetLeft, planProposal, thresholdForIsland, type PlanItem } from './planning';
import { countEvaluation, evaluateCandidate, registerKey, runProposal } from './proposalTask';
import {
  candidateIdFor, createPersister, loadCandidates, loadRunRecord, makeRunId, runPaths, type Persister,
} from './records';
import { createLimiter, type DiscoveryDeps, type DiscoveryRunContext, type DiscoveryRunOptions, type RunContext, type RunControl, type RunnerEvent } from './runContext';
import { createRng, deriveSeed, restoreRng, type Rng } from './rng';
import { migrate } from './selection';

export type { DiscoveryDeps, DiscoveryRunContext, DiscoveryRunOptions, RunnerEvent } from './runContext';

export interface DiscoveryRunHandle {
  runId: string;
  /** Resolves (never rejects) with the final run record. */
  done: Promise<RunRecord>;
  pause(): void;
  resume(): void;
  stop(): void;
  current(): RunRecord | null;
}

export type AxesResult = { ok: true; axes: readonly [ArchiveAxis, ArchiveAxis] } | { ok: false; message: string };

/** Resolve the two archive axes from the spec (or the evaluator's first two descriptors). */
export function resolveAxes(spec: DiscoverySpec, evaluator: DiscoveryEvaluatorInfo): AxesResult {
  const chosen = spec.search.archive.descriptors ?? evaluator.descriptors.slice(0, 2).map((d) => d.key);
  if (chosen.length < 2) return { ok: false, message: `Evaluator ${evaluator.kind} needs two descriptors for the archive.` };
  const axes = chosen.map((key, i) => {
    const def = evaluator.descriptors.find((d) => d.key === key);
    return def ? axisFromDescriptor(def, spec.search.archive.bins?.[i]) : null;
  });
  if (!axes[0] || !axes[1]) {
    const known = evaluator.descriptors.map((d) => d.key).join(', ');
    return { ok: false, message: `Archive descriptors [${chosen.join(', ')}] are not all evaluator descriptors (${known}).` };
  }
  return { ok: true, axes: [axes[0], axes[1]] };
}

function seedCandidate(program: string, evalSeed: number, hash: string, now: string): CandidateRecord {
  return {
    id: candidateIdFor(0), parent_id: null, island: 0, generation: 0, mutator: 'seed', program, program_sha256: hash,
    llm: null, ast_ops: null, evaluation: null, created_at: now, outcome: 'pending', eval_seed: evalSeed,
    inspiration_ids: [], screen: null, duplicate_of: null, proposal_error: null, in_archive: false,
    region_warning: false, reevaluations: [],
  };
}

export function runDiscovery(
  spec: DiscoverySpec,
  rctx: DiscoveryRunContext,
  deps: DiscoveryDeps,
  opts: DiscoveryRunOptions = {},
): DiscoveryRunHandle {
  let paused = false;
  /** When the current pause began, and the total paused time so far: neither counts as wall time (CR-M8). */
  let pausedAt: number | null = null;
  let pausedTotalMs = 0;
  let stopped = false;
  /** Set when the kernel connection is lost: the run ends as failed (CR-H7). */
  let fatal: string | null = null;
  let finished = false;
  const llmAbort = new AbortController();
  let run: RunRecord | null = null;
  let onControlChange: () => void = () => undefined;
  const gateWaiters: Array<() => void> = [];
  const releaseGate = () => gateWaiters.splice(0).forEach((resolve) => resolve());
  const control: RunControl = {
    get stopped() { return stopped || fatal !== null; },
    get paused() { return paused; },
    gate: () => (paused && !stopped && fatal === null ? new Promise<void>((resolve) => gateWaiters.push(resolve)) : Promise.resolve()),
  };
  const startedAt = deps.clock.now();
  const runId = rctx.resumeRunId ?? makeRunId(startedAt, deriveSeed(spec.seed, startedAt.getTime()));
  const emit = (event: RunnerEvent) => opts.onEvent?.(event);
  let kernel: KernelEvaluator | null = null;
  let auditClient: AuditClient | null = null;

  const done = execute().catch((e: unknown): RunRecord => {
    const message = `Discovery run crashed: ${e instanceof Error ? e.message : String(e)}`;
    const failed = { ...(run as RunRecord), status: 'failed' as RunStatus, stop_reason: 'error' as StopReason, message };
    emit({ type: 'status', run: failed });
    return failed;
  }).finally(() => {
    finished = true;
    kernel?.dispose();
    auditClient?.dispose();
  });

  async function execute(): Promise<RunRecord> {
    const paths = runPaths(deps.join, rctx.projectRoot, rctx.definitionFile, runId);
    const persistErrors: string[] = [];
    const persister: Persister = createPersister(deps.fs, paths, (m) => {
      persistErrors.push(m);
      emit({ type: 'notice', message: m });
    });
    const axes = resolveAxes(spec, rctx.evaluator);
    const candidates = new Map<string, CandidateRecord>();
    let rng: Rng = createRng(spec.seed);
    const segmentStart = deps.clock.now().getTime();
    let priorWall = 0;

    // ── Load or create the run record ─────────────────────────────────
    if (rctx.resumeRunId) {
      const loaded = await loadRunRecord(deps.fs, paths);
      if (!loaded) return fail(`Run ${runId} has no readable run.json to resume.`);
      const files = await loadCandidates(deps.fs, paths);
      files.candidates.forEach((c) => candidates.set(c.id, c));
      files.warnings.forEach((w) => emit({ type: 'notice', message: w }));
      run = { ...loaded, status: 'running', stop_reason: null, message: null, finished_at: null };
      priorWall = loaded.usage.wall_ms;
      rng = restoreRng(loaded.rng);
      if (loaded.status === 'completed' || loaded.status === 'failed') {
        run = loaded;
        emit({ type: 'status', run });
        return loaded;
      }
    } else {
      if (!axes.ok) return fail(axes.message);
      run = {
        schema: 1, run_id: runId, definition_file: rctx.definitionFile, spec,
        evaluator: { kind: rctx.evaluator.kind, version: rctx.evaluator.version, fingerprint: null },
        status: 'running', stop_reason: null, message: null, started_at: startedAt.toISOString(),
        updated_at: startedAt.toISOString(), finished_at: null, generation: 0, next_candidate_index: 1,
        rng: rng.state(), archive: createArchive(axes.axes, rctx.evaluator.objectives, spec.search.islands),
        usage: emptyUsage(), champion_id: null, seed_fitness: null, best_fitness_history: [], stale_generations: 0,
        pending_batch: null, notices: [], confirmation: null,
      };
    }

    const redQueen = isRedQueen(spec);
    if (redQueen && !deps.llm.hasKey()) {
      return fail('Red Queen mode needs an Anthropic API key: the adversary is an LLM. Add one in Settings, Dirac, or pick another mutator.');
    }
    if (spec.mutator.kind === 'llm' && !deps.llm.hasKey()) {
      return fail('LLM mutation needs an Anthropic API key. Add one in Settings, Dirac, or switch the mutator to hybrid or ast.');
    }

    const wall = () => {
      const now = deps.clock.now().getTime();
      const pausedNow = pausedAt !== null ? now - pausedAt : 0;
      return priorWall + Math.max(0, now - segmentStart - pausedTotalMs - pausedNow);
    };
    const snapshot = (): RunRecord => ({ ...(run as RunRecord), usage: { ...(run as RunRecord).usage, wall_ms: wall() } });
    const persistRun = () => {
      run = { ...snapshot(), rng: rng.state(), updated_at: deps.clock.now().toISOString() };
      persister.writeRun(run);
      emit({ type: 'status', run });
    };
    const setRun = (patch: Partial<RunRecord>) => {
      run = { ...(run as RunRecord), ...patch };
      emit({ type: 'status', run: snapshot() });
    };

    kernel = createKernelEvaluator({ session: deps.session, info: rctx.evaluator, sleep: deps.clock.sleep });
    const k = kernel;
    k.onFatal((message) => {
      if (fatal !== null || finished) return;
      fatal = `${message} The run ended because evaluations can no longer be sent; resume it once the kernel is back.`;
      llmAbort.abort();
      releaseGate();
    });
    /** How a halted run ends: failed on a lost kernel, otherwise a user stop. */
    const haltFinish = () => (fatal !== null ? finish('error', fatal) : finish('user'));
    auditClient = createAuditClient({ session: deps.session, sleep: deps.clock.sleep });
    const promptInput = { evaluator: rctx.evaluator, task: spec.description, entry: spec.entry };
    const ctx: RunContext = {
      spec, runId, evaluator: rctx.evaluator, deps, kernel: k, audits: auditClient,
      rq: redQueen ? { config: redQueenConfig(spec), policy: EMPTY_POLICY, started: 0, findings: [] } : null,
      control,
      signal: llmAbort.signal,
      system: redQueen ? buildRedQueenSystemPrompt(promptInput) : buildSystemPrompt(promptInput),
      candidates, seenHashes: new Map(), seenProgramKeys: new Map(), keyClaims: new Map(), rejections: [],
      evalLimit: createLimiter(spec.budget.max_concurrent_evaluations),
      llmLimit: createLimiter(opts.maxLlmConcurrency ?? 4),
      getRun: () => run as RunRecord,
      setUsage: (update) => setRun({ usage: update((run as RunRecord).usage) }),
      setRun,
      saveCandidate: (c) => {
        candidates.set(c.id, c);
        persister.writeCandidate(c);
        emit({ type: 'candidate', candidate: c });
      },
      notice: (message) => {
        const r = run as RunRecord;
        if (r.notices.includes(message)) return;
        setRun({ notices: [...r.notices, message].slice(-20) });
        emit({ type: 'notice', message });
      },
      activity: (candidateId, phase) => emit({ type: 'activity', candidateId, phase }),
      persister,
    };
    for (const c of [...candidates.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (c.outcome === 'invalid_proposal') continue;
      ctx.seenHashes.set(c.program_sha256, c.id);
      if (c.outcome !== 'duplicate') registerKey(ctx, c.evaluation?.program_key, c.id, c.evaluation);
      if (c.evaluation?.status === 'rejected' && c.evaluation.rejection) ctx.rejections.push(c.evaluation.rejection);
    }
    if (rctx.resumeRunId) rebuildRedQueen(ctx, [...candidates.values()]);
    const integrated = new Set(
      [...candidates.values()]
        .filter((c) => c.generation <= (run as RunRecord).generation && c.outcome !== 'pending')
        .map((c) => c.id),
    );

    onControlChange = () => {
      if (finished || !run) return;
      const r = run as RunRecord;
      if (stopped || fatal !== null || (paused ? 'paused' : 'running') === r.status) return;
      setRun({ status: paused ? 'paused' : 'running' });
      persistRun();
    };
    if (paused) onControlChange();

    /** Insert one candidate into the archive; Red Queen mode stores the adversarial fitness (redQueen.ts). */
    const insertCandidate = (c: CandidateRecord) => {
      if (c.outcome !== 'evaluated' || !c.evaluation) return;
      let archive = (run as RunRecord).archive;
      const evaluation = ctx.rq ? { ...c.evaluation, fitness: c.adversarial_fitness ?? 0 } : c.evaluation;
      const elite = eliteFromEvaluation(archive, { candidateId: c.id, island: c.island, programHash: c.program_sha256 }, evaluation);
      if (!elite) return;
      const targets = c.mutator === 'seed' ? archive.islands.map((_, i) => i) : [c.island];
      let accepted = false;
      for (const island of targets) {
        const res = insertElite(archive, { ...elite, island });
        archive = res.archive;
        accepted = accepted || res.accepted;
      }
      setRun({ archive });
      if (accepted) ctx.saveCandidate({ ...c, in_archive: true });
    };

    const integrate = (generation: number) => {
      const batch = [...candidates.values()].filter((c) => c.generation === generation && !integrated.has(c.id));
      for (const c of batch.sort((a, b) => a.id.localeCompare(b.id))) {
        if (c.outcome === 'pending') continue;
        integrated.add(c.id);
        insertCandidate(c);
      }
      const best = bestElite((run as RunRecord).archive);
      setRun({ champion_id: best?.candidateId ?? null });
    };

    // ── Seed ──────────────────────────────────────────────────────────
    if (!rctx.resumeRunId) {
      const hash = await deps.hash(rctx.seedProgram);
      const seed = seedCandidate(rctx.seedProgram, rng.childSeed(), hash, startedAt.toISOString());
      const region = findRegion(rctx.seedProgram);
      const withWarning = { ...seed, region_warning: region.ok && region.region.wholeFile };
      if (withWarning.region_warning) ctx.notice('The seed program has no EVOLVE-BLOCK markers; the whole file is editable.');
      ctx.saveCandidate(withWarning);
      ctx.seenHashes.set(hash, seed.id);
    }
    const seedRecord = candidates.get(candidateIdFor(0));
    if (seedRecord && seedRecord.outcome === 'pending') {
      persistRun();
      const evaluated = await evaluateSeed(ctx, seedRecord);
      if (evaluated.outcome === 'pending') return haltFinish();
      ctx.saveCandidate(evaluated);
      const ev = evaluated.evaluation;
      registerKey(ctx, ev?.program_key, evaluated.id, ev);
      if (ev?.evaluator.fingerprint) setRun({ evaluator: { ...(run as RunRecord).evaluator, fingerprint: ev.evaluator.fingerprint } });
      integrate(0);
      observeSeed(ctx, evaluated);
      if (ev?.status !== 'scored') {
        const why = ev?.rejection ? `${ev.rejection.guardrail}: ${ev.rejection.message}` : ev?.failure?.message ?? 'unknown reason';
        return finish('seed_rejected', `The seed program was not scored (${why}). Fix the seed before searching.`);
      }
      setRun({ seed_fitness: ev.fitness });
      persistRun();
    }

    // ── Resume: send unanswered audits again ──────────────────────────
    if (rctx.resumeRunId && ctx.rq) {
      const resent = await Promise.all(pendingAudits(candidates.values()).map((c) => runAudit(ctx, c)));
      for (const c of resent) if (integrated.has(c.id) && c.audit) insertCandidate(c);
      if (control.stopped) return haltFinish();
    }

    // ── Generations ───────────────────────────────────────────────────
    let stopReason: StopReason | null = null;
    while (!control.stopped && !stopReason && (run as RunRecord).generation < spec.search.generations) {
      await control.gate();
      if (control.stopped) break;
      const g = (run as RunRecord).generation + 1;
      const outcome = await runGeneration(g);
      if (outcome.interrupted) break;
      integrate(g);
      const migrated = migrate((run as RunRecord).archive, g, spec.search.migration_interval);
      const best = bestElite(migrated.archive)?.fitness ?? null;
      const prev = (run as RunRecord).best_fitness_history.at(-1) ?? (ctx.rq ? 0 : (run as RunRecord).seed_fitness);
      const improved = best !== null && (prev === null || best > prev + 1e-12);
      setRun({
        archive: migrated.archive, generation: g,
        best_fitness_history: best === null ? (run as RunRecord).best_fitness_history : [...(run as RunRecord).best_fitness_history, best],
        stale_generations: improved ? 0 : (run as RunRecord).stale_generations + 1,
      });
      persistRun();
      stopReason = outcome.budgetStop;
      const patience = spec.search.early_stop_patience;
      if (!stopReason && patience > 0 && (run as RunRecord).stale_generations >= patience) stopReason = 'early_stop';
    }
    if (control.stopped) return haltFinish();
    return finish(stopReason ?? 'generations');

    // ── Generation ────────────────────────────────────────────────────
    async function runGeneration(g: number): Promise<{ interrupted: boolean; budgetStop: StopReason | null }> {
      const r0 = run as RunRecord;
      const resumeBatch = r0.pending_batch?.generation === g ? r0.pending_batch : null;
      const orphans = [...candidates.values()].filter((c) => c.generation === g && c.mutator !== 'seed');
      const requeue = orphans.filter((c) => c.outcome === 'pending' && c.evaluation === null && !c.proposal_error);
      // Resumed batch items go through the same cascade as fresh ones and get their own derived AST seed (CR-M8).
      const planned: PlanItem[] = (resumeBatch?.items ?? []).map((it) => ({
        candidateId: it.candidate_id, island: it.island, parentId: it.parent_id, inspirationIds: it.inspiration_ids,
        mutator: 'llm', tier: it.tier, depth: it.depth, thinking: it.thinking,
        astSeed: deriveSeed(spec.seed, `ast:${it.candidate_id}`), evalSeed: it.eval_seed,
        threshold: thresholdForIsland(spec, r0.archive, it.island, candidates),
      }));
      // Their LLM calls were counted when the batch was submitted, before the interruption.
      const resumedIds = new Set(planned.map((p) => p.candidateId));
      let budgetStop: StopReason | null = null;
      const target = spec.search.candidates_per_generation - orphans.length - planned.length;
      for (let n = 0; n < target; n += 1) {
        const r = run as RunRecord;
        const view = {
          usage: r.usage, wallMs: wall(),
          plannedEvaluations: (planned.length + requeue.length) * (spec.evaluation.cascade ? 2 : 1),
          plannedLlmCalls: planned.filter((p) => p.mutator === 'llm' && !resumedIds.has(p.candidateId)).length,
        };
        budgetStop = exhaustedBudget(spec, view);
        if (budgetStop) break;
        const plan = planProposal({
          spec, archive: r.archive, rng, candidateId: candidateIdFor(r.next_candidate_index),
          proposalIndex: r.next_candidate_index, llmAvailable: deps.llm.hasKey(), llmBudgetLeft: llmBudgetLeft(spec, view), candidates,
        });
        if (plan.kind === 'stop') { budgetStop = plan.reason; break; }
        if (plan.kind === 'empty') break;
        if (plan.llmFallback === 'no_key') ctx.notice('No Anthropic API key: using AST mutations only.');
        if (plan.llmFallback === 'llm_budget') ctx.notice('LLM call budget used up: using AST mutations for the rest of the run.');
        planned.push(plan.item);
        setRun({ next_candidate_index: r.next_candidate_index + 1 });
      }
      persistRun();

      const frozen = (run as RunRecord).archive;
      const batch = await resolveBatch(g, planned, resumeBatch !== null);
      if (batch === 'interrupted') return { interrupted: true, budgetStop };
      const tasks: Array<Promise<unknown>> = [
        ...requeue.map((c) =>
          evaluateCandidate(ctx, c, thresholdForIsland(spec, frozen, c.island, candidates)).then(async (done) => {
            ctx.saveCandidate(done);
            await auditIfDue(ctx, done);
          })),
        ...planned.map((item) =>
          runProposal(ctx, item, g, batch ? { result: batch.results[item.candidateId], batchId: batch.id } : undefined)),
      ];
      await Promise.all(tasks);
      return { interrupted: control.stopped, budgetStop };
    }

    async function resolveBatch(g: number, planned: PlanItem[], resuming: boolean) {
      const llmItems = planned.filter((p) => p.mutator === 'llm');
      if (!spec.mutator.batch_mode || llmItems.length === 0) return null;
      await control.gate();
      if (control.stopped) return 'interrupted' as const;
      if (!resuming) {
        const submitted = await submitBatch(ctx, llmItems, g);
        if (!submitted.ok) {
          ctx.notice(`Batch submit failed: ${submitted.message}`);
          return { id: '', results: {} };
        }
        setRun({ pending_batch: submitted.pending, usage: { ...(run as RunRecord).usage, llm_calls: (run as RunRecord).usage.llm_calls + submitted.pending.items.length } });
        persistRun();
      }
      const pending = (run as RunRecord).pending_batch;
      if (!pending) return null;
      const outcome = await awaitBatch(ctx, pending);
      if (outcome === 'interrupted') return 'interrupted' as const;
      setRun({ pending_batch: null });
      persistRun();
      return { id: pending.batch_id, results: outcome };
    }

    // ── Finish ────────────────────────────────────────────────────────
    async function finish(reason: StopReason, message: string | null = null): Promise<RunRecord> {
      const r = run as RunRecord;
      const userStop = reason === 'user';
      const failed = reason === 'seed_rejected' || reason === 'error';
      const noExploits = ctx.rq !== null && !userStop && !failed && ![...candidates.values()].some((c) => c.audit?.verdict === 'exploit');
      setRun({ status: failed ? 'failed' : userStop ? 'stopped' : 'completed', stop_reason: reason, message: noExploits ? NO_EXPLOIT_MESSAGE : message });
      if (noExploits) ctx.notice(NO_EXPLOIT_MESSAGE);
      if (userStop) k.cancelRun(runId);
      const champion = r.champion_id ? candidates.get(r.champion_id) : undefined;
      // Red Queen champions are chosen by adversarial fitness; confirming their evaluator score on fresh seeds says nothing about robustness.
      if (champion && !userStop && !failed && !ctx.rq && spec.confirm.seeds > 0 && champion.evaluation) {
        const confirmation = await confirmChampion(ctx, champion, spec.confirm.seeds, 'run');
        if (control.stopped && confirmation.n_scored < spec.confirm.seeds) {
          // Stop (or a lost kernel) cut the confirmation short: a partial one would misreport the number.
          ctx.notice('Confirmation was stopped before it finished; the champion number is unconfirmed.');
        } else {
          setRun({ confirmation });
        }
      }
      if (champion && !userStop && !failed) persister.writeChampion(champion.program);
      setRun({ finished_at: deps.clock.now().toISOString() });
      persistRun();
      await persister.flush();
      if (persistErrors.length > 0) emit({ type: 'notice', message: `${persistErrors.length} file write(s) failed; see earlier notices.` });
      return run as RunRecord;
    }
  }

  function fail(message: string): RunRecord {
    const base = run ?? {
      schema: 1 as const, run_id: runId, definition_file: rctx.definitionFile, spec,
      evaluator: { kind: rctx.evaluator.kind, version: rctx.evaluator.version, fingerprint: null },
      status: 'failed' as RunStatus, stop_reason: 'error' as StopReason, message, started_at: startedAt.toISOString(),
      updated_at: startedAt.toISOString(), finished_at: startedAt.toISOString(), generation: 0, next_candidate_index: 1,
      rng: [1, 2, 3, 4] as const, archive: createArchive([{ key: '', label: '', min: 0, max: 1, bins: 1 }, { key: '', label: '', min: 0, max: 1, bins: 1 }], [], 1),
      usage: emptyUsage(), champion_id: null, seed_fitness: null, best_fitness_history: [], stale_generations: 0,
      pending_batch: null, notices: [], confirmation: null,
    };
    const failed: RunRecord = { ...base, status: 'failed', stop_reason: 'error', message };
    run = failed;
    emit({ type: 'status', run: failed });
    return failed;
  }

  return {
    runId,
    done,
    pause() {
      if (finished || stopped || paused) return;
      paused = true;
      pausedAt = deps.clock.now().getTime();
      onControlChange();
    },
    resume() {
      if (finished || !paused) return;
      paused = false;
      if (pausedAt !== null) pausedTotalMs += Math.max(0, deps.clock.now().getTime() - pausedAt);
      pausedAt = null;
      releaseGate();
      onControlChange();
    },
    stop() { if (!finished && !stopped) { stopped = true; llmAbort.abort(); releaseGate(); kernel?.cancelRun(runId); auditClient?.cancel(runId); } },
    current: () => run,
  };
}

/**
 * Evaluate the seed. With the cascade on, the seed is screened first too
 * (CR-C1): its screen result is the per-island reference children are
 * compared with, so the promotion test is like-for-like.
 */
async function evaluateSeed(ctx: RunContext, seed: CandidateRecord): Promise<CandidateRecord> {
  const { spec } = ctx;
  const run = async (stage: 'screen' | 'full') => {
    const evaluation = await ctx.kernel.evaluate({
      runId: ctx.runId, wireId: seed.id, evaluator: { kind: spec.evaluator.kind, config: spec.evaluator.config },
      program: seed.program, entry: spec.entry, seed: seed.eval_seed, stage,
    });
    ctx.setUsage(countEvaluation);
    return evaluation;
  };
  const cancelled = (e: DiscoveryEvaluation) => (e.status === 'failed' && e.failure?.code === 'cancelled') || isTransportFailure(e);
  let screen: DiscoveryEvaluation | null = null;
  if (spec.evaluation.cascade) {
    screen = await run('screen');
    if (cancelled(screen)) return seed;
    // A seed the screen cannot score stays final: the run fails on it.
    if (screen.status !== 'scored') return { ...seed, evaluation: screen, screen, outcome: 'evaluated' };
  }
  const evaluation = await run('full');
  if (cancelled(evaluation)) return screen ? { ...seed, screen } : seed;
  return { ...seed, evaluation, screen, outcome: 'evaluated' };
}
