/**
 * Live view of one run for the store and UI: the run record, its candidates
 * and per-candidate activity, folded from runner events (immutable updates).
 */

import type { CandidateRecord, RunRecord } from '../../types/discovery';
import { MAX_NOTICES, type RunnerEvent } from './runContext';

export interface RunView {
  run: RunRecord;
  candidates: Record<string, CandidateRecord>;
  /** Candidate ids in creation order. */
  order: string[];
  /** Candidates currently being proposed or evaluated, by phase. */
  activity: Record<string, 'proposing' | 'screening' | 'evaluating'>;
  /** Runner notices and file-write problems, newest last (capped). */
  notices: string[];
}

export const MAX_VIEW_NOTICES = MAX_NOTICES;

export function createRunView(run: RunRecord, candidates: readonly CandidateRecord[] = []): RunView {
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  return {
    run,
    candidates: Object.fromEntries(sorted.map((c) => [c.id, c])),
    order: sorted.map((c) => c.id),
    activity: {},
    notices: [...run.notices],
  };
}

export function reduceRunEvent(view: RunView, event: RunnerEvent): RunView {
  switch (event.type) {
    case 'status': {
      const finished = event.run.status !== 'running' && event.run.status !== 'paused';
      return { ...view, run: event.run, activity: finished ? {} : view.activity };
    }
    case 'candidate': {
      const c = event.candidate;
      const known = view.candidates[c.id] !== undefined;
      const { [c.id]: _settled, ...activity } = view.activity;
      void _settled;
      return {
        ...view,
        candidates: { ...view.candidates, [c.id]: c },
        // Candidates are created in id order, so a new one is simply the newest: append, no re-sort (CR-M10).
        order: known ? view.order : [...view.order, c.id],
        activity: c.outcome === 'pending' ? view.activity : activity,
      };
    }
    case 'activity': {
      if (event.phase === 'idle') {
        const { [event.candidateId]: _gone, ...rest } = view.activity;
        void _gone;
        return { ...view, activity: rest };
      }
      return { ...view, activity: { ...view.activity, [event.candidateId]: event.phase } };
    }
    case 'notice':
      return view.notices.includes(event.message)
        ? view
        : { ...view, notices: [...view.notices, event.message].slice(-MAX_VIEW_NOTICES) };
  }
}

/** Last list per `candidates` object: status, activity and notice events leave it untouched, so the list (and every memo on it) stays stable. */
const listCache = new WeakMap<object, { order: readonly string[]; list: CandidateRecord[] }>();

export function candidateList(view: Pick<RunView, 'order' | 'candidates'>): CandidateRecord[] {
  const cached = listCache.get(view.candidates);
  if (cached && cached.order === view.order) return cached.list;
  const list = view.order.map((id) => view.candidates[id]).filter((c): c is CandidateRecord => c !== undefined);
  listCache.set(view.candidates, { order: view.order, list });
  return list;
}
