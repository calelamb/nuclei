import type { ResolvedMethod } from '../../types/trainability';
import { intervalNounOf, methodDescription, type IntervalSource } from '../../services/trainability/intervals';

/** Label for the interval of a result: kind first, then the estimator. */
export function intervalNoun(source: ResolvedMethod | null | undefined | IntervalSource): string {
  if (source === undefined || source === null || typeof source === 'string') {
    return intervalNounOf({ method: source ?? undefined });
  }
  return intervalNounOf(source);
}

export function methodName(method: ResolvedMethod | null | undefined): string {
  return method === 'ppe' ? 'Pauli propagation' : 'Sampling';
}

export { methodDescription };
