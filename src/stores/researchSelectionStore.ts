import { create } from 'zustand';
import { z } from 'zod';
import type { QecEntityKind, QecEntityRef, ResearchSelection } from '../types/qecSelection';

const MAX_HISTORY_ENTRIES = 100;
const ENTITY_KINDS = [
  'study', 'source', 'session', 'dataset', 'circuit-revision', 'tick', 'qubit',
  'stabilizer', 'detector', 'edge', 'logical-observable', 'campaign-point',
  'decoder', 'shot', 'round', 'time-window', 'calibration-record', 'cohort',
  'alert', 'finding',
] as const satisfies readonly QecEntityKind[];

export const qecEntityRefSchema = z.object({
  kind: z.enum(ENTITY_KINDS),
  id: z.string().trim().min(1),
  sessionId: z.string().trim().optional().transform((value) => value || undefined),
  datasetId: z.string().trim().optional().transform((value) => value || undefined),
});
export const selectionSourceSchema = z.enum(['user', 'panel', 'alert', 'dirac', 'restore']);
export const timeWindowSchema = z.object({
  start: z.number().finite(),
  end: z.number().finite(),
  domain: z.enum(['tick', 'round', 'ns']),
}).refine((window) => window.start <= window.end, {
  message: 'The time window start must not exceed its end.',
});

export const EMPTY_RESEARCH_SELECTION: ResearchSelection = {
  primary: null,
  scope: [],
  timeWindow: null,
  source: 'user',
};

export interface ResearchSelectionState {
  past: readonly ResearchSelection[];
  present: ResearchSelection;
  future: readonly ResearchSelection[];
  selectPrimary(ref: QecEntityRef, source: ResearchSelection['source']): void;
  refineScope(ref: QecEntityRef, source: ResearchSelection['source']): void;
  setTimeWindow(window: ResearchSelection['timeWindow'], source: ResearchSelection['source']): void;
  back(): void;
  forward(): void;
  clear(): void;
  restore(selection: ResearchSelection): void;
}

function normalizeRef(ref: QecEntityRef): QecEntityRef | null {
  const parsed = qecEntityRefSchema.safeParse(ref);
  return parsed.success ? parsed.data : null;
}

function normalizeWindow(
  window: ResearchSelection['timeWindow'],
): ResearchSelection['timeWindow'] | undefined {
  if (window === null) return null;
  const parsed = timeWindowSchema.safeParse(window);
  return parsed.success ? parsed.data : undefined;
}

function isSource(source: ResearchSelection['source']): boolean {
  return selectionSourceSchema.safeParse(source).success;
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

function normalizeSelection(selection: ResearchSelection): ResearchSelection {
  const primary = selection.primary ? normalizeRef(selection.primary) : null;
  const scope = selection.scope.flatMap((entry) => {
    const normalized = normalizeRef(entry);
    return normalized ? [normalized] : [];
  });
  const timeWindow = normalizeWindow(selection.timeWindow);
  return {
    primary,
    scope,
    timeWindow: timeWindow === undefined ? null : timeWindow,
    source: 'restore',
  };
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
  restore: (selection) => set({
    past: [],
    present: normalizeSelection(selection),
    future: [],
  }),
}));
