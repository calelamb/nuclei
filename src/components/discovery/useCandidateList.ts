import { useMemo } from 'react';
import type { CandidateRecord } from '../../types/discovery';
import { candidateList, type RunView } from '../../services/discovery/runView';

/** The run's candidates in creation order; recomputed only when candidates are added or replaced, not on status or activity events (CR-M10). */
export function useCandidateList(view: Pick<RunView, 'order' | 'candidates'>): CandidateRecord[] {
  const { order, candidates } = view;
  return useMemo(() => candidateList({ order, candidates }), [order, candidates]);
}
