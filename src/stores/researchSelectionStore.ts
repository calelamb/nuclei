import { create } from 'zustand';
import type { QecEntityKind, QecEntityRef, ResearchSelection } from '../types/qecSelection';

const MAX_HISTORY_ENTRIES = 100;
const ENTITY_KINDS: ReadonlySet<QecEntityKind> = new Set([
  'study', 'source', 'session', 'dataset', 'circuit-revision', 'tick', 'qubit',
  'stabilizer', 'detector', 'edge', 'logical-observable', 'campaign-point',
  'decoder', 'shot', 'round', 'time-window', 'calibration-record', 'cohort',
  'alert', 'finding',
]);
const SELECTION_SOURCES: ReadonlySet<ResearchSelection['source']> = new Set([
  'user', 'panel', 'alert', 'dirac', 'restore',
]);
const TIME_DOMAINS: ReadonlySet<NonNullable<ResearchSelection['timeWindow']>['domain']> = new Set([
  'tick', 'round', 'ns',
]);

export const EMPTY_RESEARCH_SELECTION: ResearchSelection = {
  primary: null,
  scope: [],
  timeWindow: null,
  source: 'user',
};

interface ResearchSelectionState {
  past: readonly ResearchSelection[];
  present: ResearchSelection;
  future: readonly ResearchSelection[];
  selectPrimary(ref: QecEntityRef, source: ResearchSelection['source']): void;
  refineScope(ref: QecEntityRef, source: ResearchSelection['source']): void;
  setTimeWindow(window: ResearchSelection['timeWindow'], source: ResearchSelection['source']): void;
  back(): void;
  forward(): void;
  clear(): void;
}

function normalizeRef(ref: QecEntityRef): QecEntityRef | null {
  const candidate = ref as Partial<QecEntityRef>;
  if (
    !candidate ||
    typeof candidate.kind !== 'string' ||
    !ENTITY_KINDS.has(candidate.kind as QecEntityKind) ||
    typeof candidate.id !== 'string'
  ) {
    return null;
  }

  const id = candidate.id.trim();
  if (!id) return null;

  const sessionId = normalizeOptionalId(candidate.sessionId);
  const datasetId = normalizeOptionalId(candidate.datasetId);
  if (candidate.sessionId !== undefined && sessionId === null) return null;
  if (candidate.datasetId !== undefined && datasetId === null) return null;

  return {
    kind: candidate.kind as QecEntityKind,
    id,
    ...(sessionId ? { sessionId } : {}),
    ...(datasetId ? { datasetId } : {}),
  };
}

function normalizeOptionalId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeWindow(
  window: ResearchSelection['timeWindow'],
): ResearchSelection['timeWindow'] | undefined {
  if (window === null) return null;
  const candidate = window as NonNullable<ResearchSelection['timeWindow']>;
  if (
    !candidate ||
    !Number.isFinite(candidate.start) ||
    !Number.isFinite(candidate.end) ||
    candidate.start > candidate.end ||
    !TIME_DOMAINS.has(candidate.domain)
  ) {
    return undefined;
  }

  return { start: candidate.start, end: candidate.end, domain: candidate.domain };
}

function isSource(source: ResearchSelection['source']): boolean {
  return SELECTION_SOURCES.has(source);
}

function sameRef(left: QecEntityRef, right: QecEntityRef): boolean {
  return left.kind === right.kind &&
    left.id === right.id &&
    left.sessionId === right.sessionId &&
    left.datasetId === right.datasetId;
}

function mayRefine(primary: QecEntityRef | null, ref: QecEntityRef): boolean {
  return !primary?.sessionId ||
    !ref.sessionId ||
    primary.sessionId === ref.sessionId ||
    ref.kind === 'cohort' ||
    ref.kind === 'finding';
}

function nextHistory(past: readonly ResearchSelection[], present: ResearchSelection): ResearchSelection[] {
  return [...past, present].slice(-MAX_HISTORY_ENTRIES);
}

function commit(
  set: (partial: Pick<ResearchSelectionState, 'past' | 'present' | 'future'>) => void,
  state: ResearchSelectionState,
  present: ResearchSelection,
): void {
  set({ past: nextHistory(state.past, state.present), present, future: [] });
}

export const useResearchSelectionStore = create<ResearchSelectionState>((set, get) => ({
  past: [],
  present: EMPTY_RESEARCH_SELECTION,
  future: [],
  selectPrimary: (ref, source) => {
    const normalized = normalizeRef(ref);
    if (!normalized || !isSource(source)) return;
    const state = get();
    commit(set, state, { primary: normalized, scope: [], timeWindow: null, source });
  },
  refineScope: (ref, source) => {
    const normalized = normalizeRef(ref);
    if (!normalized || !isSource(source)) return;
    const state = get();
    if (!mayRefine(state.present.primary, normalized)) return;
    const scope = state.present.scope.some((entry) => sameRef(entry, normalized))
      ? state.present.scope
      : [...state.present.scope, normalized];
    commit(set, state, { ...state.present, scope, source });
  },
  setTimeWindow: (window, source) => {
    const normalized = normalizeWindow(window);
    if (normalized === undefined || !isSource(source)) return;
    const state = get();
    commit(set, state, { ...state.present, timeWindow: normalized, source });
  },
  back: () => {
    const state = get();
    const previous = state.past.at(-1);
    if (!previous) return;
    set({ past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] });
  },
  forward: () => {
    const state = get();
    const next = state.future[0];
    if (!next) return;
    set({ past: nextHistory(state.past, state.present), present: next, future: state.future.slice(1) });
  },
  clear: () => set({ past: [], present: EMPTY_RESEARCH_SELECTION, future: [] }),
}));
