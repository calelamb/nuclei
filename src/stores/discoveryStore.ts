/**
 * PRD 14 Discovery Engine store. It OWNS the running search (the runner and
 * its kernel session live in this module, not in a component), so a run
 * survives the panel unmounting. State is plain data for the UI; the runner
 * handles live in a module-level registry.
 *
 * Public surface for the UI: the state below, the actions, and the selectors
 * `isDiscoveryRunning` / `isDiscoveryActive` / `selectSelectedView`.
 */

import { create } from 'zustand';
import {
  scanAllRuns,
  scanDefinitions,
  type DiscoveryDefinition,
  type DiscoveryValidationError,
} from '../services/discovery/definitions';
import type { DiscoveryEnv, DiscoverySession } from '../services/discovery/env';
import { fetchEvaluators } from '../services/discovery/evaluatorCatalog';
import { computeKpis, type DiscoveryKpis } from '../services/discovery/kpis';
import { confirmRunChampion, reevaluateCandidate } from '../services/discovery/postRun';
import { loadCandidates, loadRunRecord, runPaths } from '../services/discovery/records';
import { createRunView, candidateList, reduceRunEvent, type RunView } from '../services/discovery/runView';
import {
  runDiscovery,
  type DiscoveryDeps,
  type DiscoveryRunContext,
  type DiscoveryRunHandle,
  type RunnerEvent,
} from '../services/discovery/runner';
import {
  scaffoldDiscovery,
  type ScaffoldBudgets,
  type ScaffoldMutator,
} from '../services/discovery/templates';
import type { CandidateRecord, DiscoveryEvaluatorInfo, DiscoverySpec, RunRecord } from '../types/discovery';

export type { DiscoveryDefinition, DiscoveryValidationError, DiscoveryKpis, RunView };

export type ActionResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export interface DiscoveryState {
  projectRoot: string | null;
  loading: boolean;
  /** Last action error, for a banner. Cleared by the next successful action. */
  error: string | null;
  definitions: DiscoveryDefinition[];
  validationErrors: DiscoveryValidationError[];
  /** Kernel evaluator catalogue (objectives and descriptors per kind). */
  evaluators: DiscoveryEvaluatorInfo[];
  evaluatorsError: string | null;
  /** Runs on disk (or finished this session) per definition file name, newest first. */
  runsByDefinition: Record<string, RunRecord[]>;
  /** Loaded or live runs by run id: run record, candidates, activity, notices. */
  views: Record<string, RunView>;
  /** KPIs per loaded run id, recomputed on every change. */
  kpis: Record<string, DiscoveryKpis>;
  /** Run ids whose runner is alive in this session (running or paused). */
  liveRunIds: string[];
  /** In-flight post-run actions, keyed `${runId}:confirm` or `${runId}:reeval:${candidateId}`. */
  pendingActions: Record<string, true>;
  selectedDefinition: string | null;
  selectedRunId: string | null;
  selectedCandidateId: string | null;

  configure(env: DiscoveryEnv | null): void;
  reload(projectRoot: string): Promise<void>;
  loadEvaluators(): Promise<void>;
  selectDefinition(fileName: string | null): void;
  selectRun(runId: string | null): Promise<void>;
  selectCandidate(candidateId: string | null): void;
  createFromTemplate(
    templateId: string,
    name: string,
    budgets?: ScaffoldBudgets,
    mutator?: ScaffoldMutator,
  ): Promise<ActionResult<{ definitionFile: string }>>;
  startRun(definitionFile: string): Promise<ActionResult<{ runId: string }>>;
  pauseRun(runId: string): void;
  resumeRun(runId: string): Promise<ActionResult>;
  stopRun(runId: string): void;
  /** Write a candidate's program into the project; returns the project-relative path. */
  promoteCandidate(runId: string, candidateId: string): Promise<ActionResult<{ path: string }>>;
  /** Re-evaluate the champion on fresh seeds (stage `confirm`). */
  confirmChampion(runId: string): Promise<ActionResult>;
  /** Evaluate one candidate again on a fresh seed. */
  reevaluateCandidate(runId: string, candidateId: string): Promise<ActionResult>;
  reset(): void;
}

// ── Module-level runner registry (not React state) ─────────────────────

interface LiveRun {
  handle: DiscoveryRunHandle;
  session: DiscoverySession;
}
const live = new Map<string, LiveRun>();
let env: DiscoveryEnv | null = null;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function needEnv(): DiscoveryEnv {
  if (!env) throw new Error('The Discovery Engine is not configured for this platform.');
  return env;
}

function depsFor(session: DiscoverySession): DiscoveryDeps {
  const e = needEnv();
  return { session, fs: e.fs, llm: e.llm, clock: e.clock, hash: e.hash, join: e.join };
}

function withView(state: DiscoveryState, runId: string, view: RunView): Partial<DiscoveryState> {
  const candidates = candidateList(view);
  return {
    views: { ...state.views, [runId]: view },
    kpis: { ...state.kpis, [runId]: computeKpis(view.run, candidates) },
  };
}

function upsertRun(runs: RunRecord[] | undefined, run: RunRecord): RunRecord[] {
  const rest = (runs ?? []).filter((r) => r.run_id !== run.run_id);
  return [run, ...rest].sort((a, b) => b.run_id.localeCompare(a.run_id));
}

const emptyData = {
  projectRoot: null,
  loading: false,
  error: null,
  definitions: [] as DiscoveryDefinition[],
  validationErrors: [] as DiscoveryValidationError[],
  evaluators: [] as DiscoveryEvaluatorInfo[],
  evaluatorsError: null,
  runsByDefinition: {} as Record<string, RunRecord[]>,
  views: {} as Record<string, RunView>,
  kpis: {} as Record<string, DiscoveryKpis>,
  liveRunIds: [] as string[],
  pendingActions: {} as Record<string, true>,
  selectedDefinition: null,
  selectedRunId: null,
  selectedCandidateId: null,
};

export const useDiscoveryStore = create<DiscoveryState>((set, get) => {
  const closeSession = (session: DiscoverySession) => {
    try {
      session.close?.();
    } catch {
      /* already closed */
    }
  };

  const setPending = (key: string, on: boolean) =>
    set((s) => {
      const { [key]: _removed, ...rest } = s.pendingActions;
      void _removed;
      return { pendingActions: on ? { ...rest, [key]: true as const } : rest };
    });

  async function ensureEvaluator(session: DiscoverySession, kind: string): Promise<ActionResult<{ evaluator: DiscoveryEvaluatorInfo }>> {
    let evaluators = get().evaluators;
    if (evaluators.length === 0) {
      const res = await fetchEvaluators(session);
      if (!res.ok) {
        set({ evaluatorsError: res.error });
        return fail(`Could not load the kernel's evaluators: ${res.error}`);
      }
      evaluators = res.evaluators;
      set({ evaluators, evaluatorsError: null });
    }
    const evaluator = evaluators.find((x) => x.kind === kind);
    return evaluator ? { ok: true, evaluator } : fail(`The kernel has no "${kind}" evaluator. Update the kernel or pick another evaluator.`);
  }

  async function loadView(definitionFile: string, runId: string): Promise<RunView | null> {
    const e = needEnv();
    const root = get().projectRoot;
    if (!root) return null;
    const paths = runPaths(e.join, root, definitionFile, runId);
    const run = await loadRunRecord(e.fs, paths);
    if (!run) return null;
    const { candidates } = await loadCandidates(e.fs, paths);
    return createRunView(run.status === 'running' && !live.has(runId) ? { ...run, status: 'stale' } : run, candidates);
  }

  function launch(
    spec: DiscoverySpec,
    rctx: DiscoveryRunContext,
    session: DiscoverySession,
    initial: RunView | null,
  ): ActionResult<{ runId: string }> {
    let runId = '';
    const onEvent = (event: RunnerEvent) => {
      const current = live.get(runId)?.handle.current() ?? null;
      set((s) => {
        const base = s.views[runId] ?? (event.type === 'status' ? createRunView(event.run) : current ? createRunView(current) : null);
        return base ? withView(s, runId, reduceRunEvent(base, event)) : s;
      });
    };
    const handle = runDiscovery(spec, rctx, depsFor(session), { onEvent });
    runId = handle.runId;
    live.set(runId, { handle, session });
    set((s) => ({
      liveRunIds: [...s.liveRunIds.filter((id) => id !== runId), runId],
      selectedDefinition: rctx.definitionFile,
      selectedRunId: runId,
      selectedCandidateId: null,
      error: null,
      ...(initial ? withView(s, runId, initial) : {}),
    }));
    void handle.done.then((run) => {
      live.delete(runId);
      closeSession(session);
      set((s) => ({
        liveRunIds: s.liveRunIds.filter((id) => id !== runId),
        runsByDefinition: { ...s.runsByDefinition, [rctx.definitionFile]: upsertRun(s.runsByDefinition[rctx.definitionFile], run) },
        ...(s.views[runId] ? withView(s, runId, { ...s.views[runId], run, activity: {} }) : {}),
      }));
    });
    return { ok: true, runId };
  }

  return {
    ...emptyData,

    configure(next) {
      env = next;
    },

    async reload(projectRoot) {
      set({ loading: true, projectRoot, error: null });
      try {
        const e = needEnv();
        const { definitions, validationErrors } = await scanDefinitions(e.fs, e.join, projectRoot);
        const runsByDefinition = await scanAllRuns(e.fs, e.join, projectRoot, definitions);
        set((s) => ({
          definitions, validationErrors, runsByDefinition, loading: false,
          selectedDefinition: definitions.some((d) => d.fileName === s.selectedDefinition) ? s.selectedDefinition : null,
        }));
      } catch (e) {
        set({ loading: false, error: message(e) });
      }
    },

    async loadEvaluators() {
      let session: DiscoverySession | null = null;
      try {
        session = await needEnv().openSession();
        const res = await fetchEvaluators(session);
        set(res.ok ? { evaluators: res.evaluators, evaluatorsError: null } : { evaluatorsError: res.error });
      } catch (e) {
        set({ evaluatorsError: message(e) });
      } finally {
        if (session) closeSession(session);
      }
    },

    selectDefinition(fileName) {
      set({ selectedDefinition: fileName, selectedRunId: null, selectedCandidateId: null });
    },

    async selectRun(runId) {
      set({ selectedRunId: runId, selectedCandidateId: null });
      if (!runId || get().views[runId]) return;
      const file = Object.entries(get().runsByDefinition).find(([, runs]) => runs.some((r) => r.run_id === runId))?.[0];
      if (!file) return;
      try {
        const view = await loadView(file, runId);
        if (view) set((s) => withView(s, runId, view));
        else set({ error: `Run ${runId} could not be read from disk.` });
      } catch (e) {
        set({ error: message(e) });
      }
    },

    selectCandidate(candidateId) {
      set({ selectedCandidateId: candidateId });
    },

    async createFromTemplate(templateId, name, budgets, mutator) {
      const root = get().projectRoot;
      if (!root) return fail('Open a project first.');
      const scaffold = scaffoldDiscovery(templateId, name, budgets, mutator);
      if (!scaffold.ok) return fail(scaffold.error);
      try {
        const e = needEnv();
        for (const file of scaffold.files) {
          const full = e.join(root, file.path);
          if ((await e.fs.readFile(full)) !== null) return fail(`${file.path} already exists. Choose another name.`);
        }
        for (const file of scaffold.files) {
          const full = e.join(root, file.path);
          await e.fs.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
          await e.fs.writeFile(full, file.content);
        }
        await get().reload(root);
        const definitionFile = scaffold.definitionPath.split('/').pop() as string;
        set({ selectedDefinition: definitionFile, selectedRunId: null });
        return { ok: true, definitionFile };
      } catch (err) {
        return fail(message(err));
      }
    },

    async startRun(definitionFile) {
      const state = get();
      if (!state.projectRoot) return fail('Open a project first.');
      if (state.liveRunIds.length > 0) return fail('A discovery run is already active. Stop it or wait for it to finish.');
      const definition = state.definitions.find((d) => d.fileName === definitionFile);
      if (!definition) return fail(`${definitionFile} is not a valid discovery definition.`);
      let session: DiscoverySession | null = null;
      try {
        const e = needEnv();
        const seedProgram = await e.fs.readFile(e.join(state.projectRoot, definition.spec.program));
        if (seedProgram === null) return fail(`The seed program ${definition.spec.program} was not found.`);
        session = await e.openSession();
        const evaluator = await ensureEvaluator(session, definition.spec.evaluator.kind);
        if (!evaluator.ok) {
          closeSession(session);
          set({ error: evaluator.error });
          return evaluator;
        }
        return launch(definition.spec, { projectRoot: state.projectRoot, definitionFile, evaluator: evaluator.evaluator, seedProgram }, session, null);
      } catch (e) {
        if (session) closeSession(session);
        const error = message(e);
        set({ error });
        return fail(error);
      }
    },

    pauseRun(runId) {
      live.get(runId)?.handle.pause();
    },

    async resumeRun(runId) {
      const running = live.get(runId);
      if (running) {
        running.handle.resume();
        return { ok: true };
      }
      const state = get();
      if (!state.projectRoot) return fail('Open a project first.');
      if (state.liveRunIds.length > 0) return fail('Another discovery run is active.');
      const file = Object.entries(state.runsByDefinition).find(([, runs]) => runs.some((r) => r.run_id === runId))?.[0];
      if (!file) return fail(`Run ${runId} was not found.`);
      let session: DiscoverySession | null = null;
      try {
        const view = state.views[runId] ?? (await loadView(file, runId));
        if (!view) return fail(`Run ${runId} could not be read from disk.`);
        const seed = view.candidates['c-0000'];
        if (!seed) return fail('The run has no seed candidate to resume from.');
        session = await needEnv().openSession();
        const evaluator = await ensureEvaluator(session, view.run.spec.evaluator.kind);
        if (!evaluator.ok) {
          closeSession(session);
          return evaluator;
        }
        const launched = launch(view.run.spec, { projectRoot: state.projectRoot, definitionFile: file, evaluator: evaluator.evaluator, seedProgram: seed.program, resumeRunId: runId }, session, view);
        return launched.ok ? { ok: true } : launched;
      } catch (e) {
        if (session) closeSession(session);
        return fail(message(e));
      }
    },

    stopRun(runId) {
      live.get(runId)?.handle.stop();
    },

    async promoteCandidate(runId, candidateId) {
      const state = get();
      const view = state.views[runId];
      const candidate = view?.candidates[candidateId];
      if (!state.projectRoot || !view || !candidate) return fail('That candidate is not loaded.');
      if (!candidate.program) return fail('That candidate has no program to promote.');
      try {
        const e = needEnv();
        const seedPath = view.run.spec.program;
        const slash = seedPath.lastIndexOf('/');
        const dir = slash >= 0 ? seedPath.slice(0, slash) : '';
        const stem = seedPath.slice(slash + 1).replace(/\.py$/, '');
        const relative = [dir, `${stem}.${candidateId}.py`].filter(Boolean).join('/');
        const full = e.join(state.projectRoot, relative);
        await e.fs.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
        await e.fs.writeFile(full, candidate.program);
        if (view.run.champion_id === candidateId) {
          const paths = runPaths(e.join, state.projectRoot, view.run.definition_file, runId);
          await e.fs.writeFile(paths.championPy, candidate.program);
        }
        return { ok: true, path: relative };
      } catch (err) {
        return fail(message(err));
      }
    },

    async confirmChampion(runId) {
      return postRun(runId, 'confirm', async (rctx, deps, view) => {
        const res = await confirmRunChampion(view.run.spec, rctx, deps, runId);
        if (!res.ok) return res;
        set((s) => (s.views[runId] ? withView(s, runId, { ...s.views[runId], run: res.run }) : s));
        return { ok: true };
      });
    },

    async reevaluateCandidate(runId, candidateId) {
      return postRun(runId, `reeval:${candidateId}`, async (rctx, deps, view) => {
        const res = await reevaluateCandidate(view.run.spec, rctx, deps, runId, candidateId);
        if (!res.ok) return res;
        const updated: CandidateRecord = res.candidate;
        set((s) => (s.views[runId] ? withView(s, runId, { ...s.views[runId], candidates: { ...s.views[runId].candidates, [candidateId]: updated } }) : s));
        return { ok: true };
      });
    },

    reset() {
      for (const { handle, session } of live.values()) {
        handle.stop();
        closeSession(session);
      }
      live.clear();
      set({ ...emptyData });
    },
  };

  async function postRun(
    runId: string,
    action: string,
    work: (rctx: DiscoveryRunContext, deps: DiscoveryDeps, view: RunView) => Promise<ActionResult>,
  ): Promise<ActionResult> {
    const state = get();
    const view = state.views[runId];
    if (!state.projectRoot || !view) return fail('That run is not loaded.');
    if (live.has(runId)) return fail('Wait for the run to finish or stop it first.');
    const key = `${runId}:${action}`;
    if (state.pendingActions[key]) return fail('That action is already running.');
    setPending(key, true);
    let session: DiscoverySession | null = null;
    try {
      session = await needEnv().openSession();
      const evaluator = await ensureEvaluator(session, view.run.spec.evaluator.kind);
      if (!evaluator.ok) return evaluator;
      const rctx: DiscoveryRunContext = {
        projectRoot: state.projectRoot, definitionFile: view.run.definition_file, evaluator: evaluator.evaluator,
        seedProgram: view.candidates['c-0000']?.program ?? '',
      };
      const result = await work(rctx, depsFor(session), view);
      set({ error: result.ok ? null : result.error });
      return result;
    } catch (e) {
      const error = message(e);
      set({ error });
      return fail(error);
    } finally {
      if (session) closeSession(session);
      setPending(key, false);
    }
  }
});

// ── Selectors ──────────────────────────────────────────────────────────

/** True while any search is actively running (the status chip and the mode-switch guard use this). */
export function isDiscoveryRunning(state: Pick<DiscoveryState, 'liveRunIds' | 'views'>): boolean {
  return state.liveRunIds.some((id) => (state.views[id] ? state.views[id].run.status === 'running' : true));
}

/** True while a runner is alive, running or paused. */
export function isDiscoveryActive(state: Pick<DiscoveryState, 'liveRunIds'>): boolean {
  return state.liveRunIds.length > 0;
}

export function selectSelectedView(state: Pick<DiscoveryState, 'selectedRunId' | 'views'>): RunView | null {
  return state.selectedRunId ? state.views[state.selectedRunId] ?? null : null;
}
