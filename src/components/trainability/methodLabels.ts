import type { ResolvedMethod } from '../../types/trainability';

export function intervalNoun(method: ResolvedMethod | undefined): string {
  return method === 'ppe' ? 'rigorous truncation interval' : '95% CI';
}

export function methodName(method: ResolvedMethod | undefined): string {
  return method === 'ppe' ? 'Pauli propagation' : 'Sampling';
}
