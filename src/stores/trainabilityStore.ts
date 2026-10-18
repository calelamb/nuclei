/**
 * PRD 14 §3.1 — Trainability Lab state. Global (not component-local) so a
 * running job survives the panel unmounting: the kernel session, job handles
 * and streaming reducers live at module scope; components only read.
 */

import { create } from 'zustand';
import { labAvailability, openLabSession, LabUnavailableError, type LabPlatform } from '../services/lab/labSession';
import {
  createTrainabilityClient,
  newTrainabilityJobId,
  type JobEnd,
  type JobEvent,
  type JobHandle,
  type TrainabilityClient,
} from '../services/trainability/client';
import { exportCertificate, CertificateExportError } from '../services/trainability/certificateIo';
import { codeKey } from '../services/trainability/hash';
import { DEFAULT_OBSERVABLE, observableErrorFrom, type ObservableParseError } from '../services/trainability/observablePresets';
import {
  DEFAULT_TARGET_SETTINGS,
  availableAnalyses,
  defaultAnalyses,
  toKernelSettings,
  validateScaling,
  type TargetSettings,
} from '../services/trainability/settings';
import { kernelLanguageFor, type Framework } from '../types/quantum';
import type { PlatformBridge } from '../platform/bridge';
import {
  ACTIVE_JOB_STATUSES,
  type InspectState,
  type LintState,
  type SavedCertificate,
  type TrainabilityAnalysis,
  type TrainabilityJobRecord,
  type TrainabilityResults,
  type TrainabilityTabId,
} from '../types/trainability';

const MAX_RECENT_JOBS = 12;

export interface EditorTarget {
  code: string;
  framework: Framework;
  filePath: string | null;
}

export type ExportState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; certificate: SavedCertificate }
  | { status: 'error'; message: string };

const IDLE_INSPECT: InspectState = { status: 'idle', data: null, error: null, codeKey: null };
const IDLE_LINT: LintState = { status: 'idle', diagnostics: [], summary: null, error: null, codeKey: null };

/** Seam for tests: how a client is created. Production opens a Lab session. */
export type ClientFactory = (platform: LabPlatform) => Promise<TrainabilityClient>;

const defaultClientFactory: ClientFactory = async (platform) =>
  createTrainabilityClient(await openLabSession(platform));

interface TrainabilityState {
  platform: LabPlatform;
  /** Set when the Lab cannot reach a kernel (web build, or connect failure). */
  unavailable: { reason: 'web_build' | 'connect_failed'; message: string } | null;

  observable: string;
  observableError: ObservableParseError | null;
  settings: TargetSettings;
  /** Chosen analyses; `null` = follow the inspection's available set. */
  analysesOverride: TrainabilityAnalysis[] | null;
  activeTab: TrainabilityTabId;

  inspect: InspectState;
  lint: LintState;

  jobs: Readonly<Record<string, TrainabilityJobRecord>>;
  jobOrder: readonly string[];
  activeJobId: string | null;
  selectedJobId: string | null;

  exportState: ExportState;
  savedCertificates: readonly SavedCertificate[];
  /** Line the verdict rail asked the editor to reveal. */
  revealRequest: { line: number; nonce: number } | null;

  setPlatform(platform: LabPlatform): void;
  setObservable(observable: string): void;
  setSettings(patch: Partial<TargetSettings>): void;
  toggleAnalysis(analysis: TrainabilityAnalysis): void;
  setActiveTab(tab: TrainabilityTabId): void;
  selectJob(id: string | null): void;

  refreshInspection(target: EditorTarget): Promise<InspectState>;
  refreshLint(target: EditorTarget): Promise<void>;
  clearLint(): void;
  start(target: EditorTarget): Promise<string | null>;
  cancel(): Promise<void>;
  exportCertificate(bridge: PlatformBridge, projectRoot: string | null): Promise<void>;
  requestReveal(line: number): void;
  reset(): void;

  // Derived helpers
  effectiveAnalyses(): TrainabilityAnalysis[];
  activeJob(): TrainabilityJobRecord | null;
  displayedJob(): TrainabilityJobRecord | null;
}

// ── Module-scoped runtime (survives panel unmounts) ────────────────────────

let clientFactory: ClientFactory = defaultClientFactory;
let clientPromise: Promise<TrainabilityClient> | null = null;
const handles = new Map<string, JobHandle>();
let inspectSeq = 0;
let lintSeq = 0;

export function setTrainabilityClientFactory(factory: ClientFactory | null): void {
  clientFactory = factory ?? defaultClientFactory;
  clientPromise = null;
}

async function getClient(platform: LabPlatform): Promise<TrainabilityClient> {
  if (clientPromise) {
    const existing = await clientPromise.catch(() => null);
    if (existing && !existing.closed) return existing;
    clientPromise = null;
  }
  const pending = clientFactory(platform);
  clientPromise = pending;
  try {
    const client = await pending;
    client.onClose(() => {
      if (clientPromise === pending) clientPromise = null;
    });
    return client;
  } catch (error) {
    if (clientPromise === pending) clientPromise = null;
    throw error;
  }
}

function describeConnectError(error: unknown): { reason: 'web_build' | 'connect_failed'; message: string } {
  if (error instanceof LabUnavailableError) return { reason: 'web_build', message: error.message };
  return { reason: 'connect_failed', message: error instanceof Error ? error.message : String(error) };
}

// ── Pure reducers ──────────────────────────────────────────────────────────

function applyEvent(job: TrainabilityJobRecord, event: JobEvent): TrainabilityJobRecord {
  switch (event.kind) {
    case 'started':
      return job.status === 'starting' ? { ...job, status: 'running' } : job;
    case 'progress':
      return {
        ...job,
        status: job.status === 'starting' ? 'running' : job.status,
        progress: { ...job.progress, [event.analysis]: { fraction: event.fraction, message: event.message } },
      };
    case 'partial':
      return {
        ...job,
        status: job.status === 'starting' ? 'running' : job.status,
        results: { ...job.results, [event.analysis]: event.result } as TrainabilityResults,
        progress: { ...job.progress, [event.analysis]: { fraction: 1, message: 'done' } },
      };
  }
}

function applyEnd(job: TrainabilityJobRecord, end: JobEnd, now: number): TrainabilityJobRecord {
  const finishedAt = now;
  if (end.kind === 'result') {
    return {
      ...job,
      status: end.status === 'complete' ? 'complete' : end.status === 'cancelled' ? 'cancelled' : 'failed',
      // The final result is authoritative; keep earlier partials the kernel omitted.
      results: { ...job.results, ...end.results },
      errors: end.errors,
      elapsedMs: end.elapsedMs,
      provenance: end.provenance,
      finishedAt,
    };
  }
  if (end.kind === 'disconnected') {
    return {
      ...job,
      status: 'failed',
      error: { code: 'disconnected', message: 'The kernel connection closed while the job was running.' },
      finishedAt,
      elapsedMs: finishedAt - job.startedAt,
    };
  }
  return {
    ...job,
    status: 'failed',
    error: { code: end.error.code, message: end.error.message },
    finishedAt,
    elapsedMs: finishedAt - job.startedAt,
  };
}

function trimJobs(
  jobs: Readonly<Record<string, TrainabilityJobRecord>>,
  order: readonly string[],
): { jobs: Record<string, TrainabilityJobRecord>; order: string[] } {
  const keep = order.slice(0, MAX_RECENT_JOBS);
  const next: Record<string, TrainabilityJobRecord> = {};
  for (const id of keep) next[id] = jobs[id];
  return { jobs: next, order: keep };
}

function fileNameOf(filePath: string | null): string {
  if (!filePath) return 'untitled.py';
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

export const useTrainabilityStore = create<TrainabilityState>((set, get) => {
  const patchJob = (id: string, update: (job: TrainabilityJobRecord) => TrainabilityJobRecord) =>
    set((state) => {
      const current = state.jobs[id];
      if (!current) return state;
      return { jobs: { ...state.jobs, [id]: update(current) } };
    });

  return {
    // Safe default: nothing connects until a surface calls `setPlatform`.
    platform: 'web',
    unavailable: null,
    observable: DEFAULT_OBSERVABLE,
    observableError: null,
    settings: DEFAULT_TARGET_SETTINGS,
    analysesOverride: null,
    activeTab: 'gradients',
    inspect: IDLE_INSPECT,
    lint: IDLE_LINT,
    jobs: {},
    jobOrder: [],
    activeJobId: null,
    selectedJobId: null,
    exportState: { status: 'idle' },
    savedCertificates: [],
    revealRequest: null,

    setPlatform(platform) {
      const availability = labAvailability(platform);
      set({
        platform,
        unavailable: availability.available
          ? null
          : { reason: 'web_build', message: 'The Trainability Lab needs the desktop Python kernel.' },
      });
    },

    setObservable(observable) {
      set({ observable, observableError: null });
    },

    setSettings(patch) {
      set((state) => ({ settings: { ...state.settings, ...patch } }));
    },

    toggleAnalysis(analysis) {
      set((state) => {
        const current = state.analysesOverride ?? defaultAnalyses(state.inspect.data);
        const next = current.includes(analysis) ? current.filter((a) => a !== analysis) : [...current, analysis];
        return { analysesOverride: next };
      });
    },

    setActiveTab(activeTab) {
      set({ activeTab });
    },

    selectJob(selectedJobId) {
      set({ selectedJobId, exportState: { status: 'idle' } });
    },

    async refreshInspection(target) {
      const state = get();
      if (state.unavailable) return state.inspect;
      const key = codeKey(`${target.framework}\n${target.code}`);
      if (state.inspect.codeKey === key && state.inspect.status === 'ready') return state.inspect;
      const seq = (inspectSeq += 1);
      set((s) => ({ inspect: { ...s.inspect, status: 'loading', error: null } }));
      try {
        const client = await getClient(get().platform);
        const result = await client.inspect({
          code: target.code,
          language: kernelLanguageFor(target.framework, target.filePath),
        });
        if (seq !== inspectSeq) return get().inspect;
        const next: InspectState = result.ok
          ? { status: 'ready', data: result.value, error: null, codeKey: key }
          : { status: 'error', data: null, error: result.error.message, codeKey: key };
        set({ inspect: next });
        return next;
      } catch (error) {
        if (seq !== inspectSeq) return get().inspect;
        const described = describeConnectError(error);
        const next: InspectState = { status: 'error', data: null, error: described.message, codeKey: key };
        set({ inspect: next, unavailable: described.reason === 'web_build' ? described : get().unavailable });
        return next;
      }
    },

    async refreshLint(target) {
      if (get().unavailable) return;
      const key = codeKey(`${target.framework}\n${target.code}\n${get().observable}`);
      const seq = (lintSeq += 1);
      set((s) => ({ lint: { ...s.lint, status: 'loading', error: null } }));
      try {
        const client = await getClient(get().platform);
        const result = await client.lint({
          code: target.code,
          language: kernelLanguageFor(target.framework, target.filePath),
          observable: get().observable,
        });
        if (seq !== lintSeq) return;
        if (result.ok) {
          set({
            lint: {
              status: 'ready',
              diagnostics: result.value.diagnostics,
              summary: result.value.summary,
              error: null,
              codeKey: key,
            },
            observableError: null,
          });
        } else {
          const observableError = observableErrorFrom(result.error);
          set({
            lint: { status: 'error', diagnostics: [], summary: null, error: result.error.message, codeKey: key },
            observableError: observableError ?? get().observableError,
          });
        }
      } catch (error) {
        if (seq !== lintSeq) return;
        set({ lint: { status: 'error', diagnostics: [], summary: null, error: describeConnectError(error).message, codeKey: key } });
      }
    },

    clearLint() {
      lintSeq += 1;
      set({ lint: IDLE_LINT });
    },

    async start(target) {
      const state = get();
      if (state.unavailable || state.activeJobId) return null;
      const analyses = state.effectiveAnalyses();
      if (analyses.length === 0) return null;
      const scalingCheck = validateScaling(state.settings);
      if (analyses.includes('scaling') && (scalingCheck.qubits.error || scalingCheck.layers.error)) return null;

      const settings = toKernelSettings(state.settings, analyses, state.inspect.data);
      let client: TrainabilityClient;
      try {
        client = await getClient(state.platform);
      } catch (error) {
        set({ unavailable: describeConnectError(error) });
        return null;
      }

      const nowMs = Date.now();
      const jobId = newTrainabilityJobId();
      const record: TrainabilityJobRecord = {
        id: jobId,
        status: 'starting',
        target: {
          fileName: fileNameOf(target.filePath),
          filePath: target.filePath,
          framework: target.framework,
          nQubits: state.inspect.data?.n_qubits ?? null,
          nParameters: state.inspect.data?.parameters.length ?? null,
          observable: state.observable,
        },
        analyses,
        settings,
        progress: {},
        results: {},
        errors: {},
        startedAt: nowMs,
        finishedAt: null,
        elapsedMs: null,
        provenance: null,
        error: null,
        codeKey: codeKey(`${target.framework}\n${target.code}`),
      };
      // Register the job before the first message flies so no event can race it.
      set((s) => {
        const trimmed = trimJobs({ ...s.jobs, [jobId]: record }, [jobId, ...s.jobOrder]);
        return {
          jobs: trimmed.jobs,
          jobOrder: trimmed.order,
          activeJobId: jobId,
          selectedJobId: jobId,
          exportState: { status: 'idle' },
          observableError: null,
        };
      });

      const handle = client.start(
        {
          jobId,
          code: target.code,
          language: kernelLanguageFor(target.framework, target.filePath),
          observable: state.observable,
          analyses,
          settings,
        },
        (event) => patchJob(jobId, (job) => applyEvent(job, event)),
      );
      handles.set(jobId, handle);

      void handle.done.then((end) => {
        handles.delete(handle.jobId);
        patchJob(handle.jobId, (job) => applyEnd(job, end, Date.now()));
        if (end.kind === 'error') {
          const observableError = observableErrorFrom(end.error);
          if (observableError) set({ observableError });
        }
        set((s) => (s.activeJobId === handle.jobId ? { activeJobId: null } : s));
      });
      return jobId;
    },

    async cancel() {
      const id = get().activeJobId;
      const handle = id ? handles.get(id) : undefined;
      if (!id || !handle) return;
      patchJob(id, (job) => (ACTIVE_JOB_STATUSES.includes(job.status) ? { ...job, status: 'cancelling' } : job));
      const accepted = await handle.cancel();
      if (!accepted) {
        // Not accepted: the job already finished or is not cancellable. Restore.
        patchJob(id, (job) => (job.status === 'cancelling' ? { ...job, status: 'running' } : job));
      }
    },

    async exportCertificate(bridge, projectRoot) {
      const job = get().displayedJob();
      if (!job || job.status === 'starting' || job.status === 'running' || job.status === 'cancelling') return;
      set({ exportState: { status: 'saving' } });
      try {
        const paths = await exportCertificate(bridge, projectRoot, {
          job,
          diagnostics: get().lint.diagnostics,
          createdAt: new Date().toISOString(),
        });
        const certificate: SavedCertificate = {
          jsonPath: paths.jsonPath,
          markdownPath: paths.markdownPath,
          savedAt: Date.now(),
          fileName: job.target.fileName,
          jobId: job.id,
        };
        set((s) => ({
          exportState: { status: 'saved', certificate },
          savedCertificates: [certificate, ...s.savedCertificates.filter((c) => c.jsonPath !== certificate.jsonPath)].slice(0, 10),
        }));
      } catch (error) {
        const message =
          error instanceof CertificateExportError || error instanceof Error ? error.message : 'Could not save the certificate.';
        set({ exportState: { status: 'error', message } });
      }
    },

    requestReveal(line) {
      set((s) => ({ revealRequest: { line, nonce: (s.revealRequest?.nonce ?? 0) + 1 } }));
    },

    reset() {
      handles.clear();
      clientPromise = null;
      inspectSeq += 1;
      lintSeq += 1;
      set({
        unavailable: null,
        observable: DEFAULT_OBSERVABLE,
        observableError: null,
        settings: DEFAULT_TARGET_SETTINGS,
        analysesOverride: null,
        activeTab: 'gradients',
        inspect: IDLE_INSPECT,
        lint: IDLE_LINT,
        jobs: {},
        jobOrder: [],
        activeJobId: null,
        selectedJobId: null,
        exportState: { status: 'idle' },
        savedCertificates: [],
        revealRequest: null,
      });
    },

    effectiveAnalyses() {
      const { analysesOverride, inspect } = get();
      const available = availableAnalyses(inspect.data);
      const chosen = analysesOverride ?? available;
      return chosen.filter((a) => available.includes(a));
    },

    activeJob() {
      const { activeJobId, jobs } = get();
      return activeJobId ? jobs[activeJobId] ?? null : null;
    },

    displayedJob() {
      const { selectedJobId, jobOrder, jobs } = get();
      const id = selectedJobId ?? jobOrder[0] ?? null;
      return id ? jobs[id] ?? null : null;
    },
  };
});

/** True while any trainability job is starting, running or cancelling. */
export function isTrainabilityJobActive(state: Pick<TrainabilityState, 'activeJobId' | 'jobs'>): boolean {
  const job = state.activeJobId ? state.jobs[state.activeJobId] : undefined;
  return !!job && ACTIVE_JOB_STATUSES.includes(job.status);
}
