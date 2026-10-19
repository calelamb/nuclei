import { describe, expect, it } from 'vitest';
import { DEFAULT_OBSERVABLE, effectiveObservable, reconcileObservable } from './observablePresets';
import { diagnosticMessage } from './diagnosticCopy';
import {
  intervalKindOf,
  intervalNounOf,
  isNumber,
  methodDescription,
  relativeWidth,
  validInterval,
} from './intervals';

describe('intervals', () => {
  it('only accepts a finite [lo, hi] pair, never the kernel interval object', () => {
    expect(validInterval([1, 2])).toEqual([1, 2]);
    expect(validInterval({ kind: 'truncation' })).toBeNull();
    expect(validInterval([1, null])).toBeNull();
    expect(validInterval([Number.NaN, 1])).toBeNull();
    expect(validInterval(null)).toBeNull();
    expect(validInterval(undefined)).toBeNull();
  });

  it('labels by interval_kind, then interval.kind, then the method', () => {
    expect(intervalKindOf({ interval_kind: 'truncation' })).toBe('truncation');
    expect(intervalKindOf({ interval: { kind: 'truncation' } })).toBe('truncation');
    expect(intervalKindOf({ interval: { kind: 'bootstrap' }, method: 'ppe' })).toBe('bootstrap');
    expect(intervalKindOf({ method: 'ppe' })).toBe('truncation');
    expect(intervalKindOf({})).toBe('bootstrap');
    expect(intervalNounOf({ method: 'ppe' })).toBe('rigorous truncation interval');
    expect(intervalNounOf({ method: 'sampling' })).toBe('95% bootstrap CI');
  });

  it('describes PPE as exact with no sampling', () => {
    expect(methodDescription('ppe')).toBe('exact Pauli propagation, no sampling');
    expect(methodDescription('sampling')).toBe('Monte-Carlo sampling');
  });

  it('computes relative width only from usable inputs', () => {
    expect(relativeWidth(2, [1, 3])).toBe(1);
    expect(relativeWidth(null, [1, 3])).toBeNull();
    expect(relativeWidth(2, { kind: 'truncation' })).toBeNull();
    expect(relativeWidth(0, [0, 1])).toBeNull();
    expect(isNumber(Number.NaN)).toBe(false);
    expect(isNumber(0)).toBe(true);
  });
});

describe('observable reconciliation', () => {
  const dflt = { observable: DEFAULT_OBSERVABLE, source: 'default' as const };
  it('prefills from the file unless the user took over', () => {
    expect(reconcileObservable(dflt, 'preset:tfim')).toEqual({ observable: 'preset:tfim', source: 'file' });
    expect(reconcileObservable({ observable: 'Z0', source: 'user' }, 'preset:tfim')).toEqual({ observable: 'Z0', source: 'user' });
  });
  it('returns to the default only when a file-sourced value loses its declaration', () => {
    expect(reconcileObservable({ observable: 'preset:tfim', source: 'file' }, null)).toEqual(dflt);
    expect(reconcileObservable(dflt, null)).toBe(dflt);
    expect(reconcileObservable(dflt, '  ')).toBe(dflt);
  });
  it('sends the default preset for an emptied field', () => {
    expect(effectiveObservable('')).toBe(DEFAULT_OBSERVABLE);
    expect(effectiveObservable('   ')).toBe(DEFAULT_OBSERVABLE);
    expect(effectiveObservable(' Z0 ')).toBe('Z0');
  });
});

describe('diagnosticMessage (PH-M3)', () => {
  const old =
    'dim 𝔤 = 15 ≤ 4n² = 36: the circuit is trainable in the barren-plateau sense but likely classically simulable with 𝔤-sim when the observable or state lies in 𝔤.';
  it('softens the TRN003 over-claim', () => {
    const soft = diagnosticMessage({ code: 'TRN003', message: old });
    expect(soft).not.toContain('is trainable');
    expect(soft).toContain('does not bound the gradient variance');
    expect(soft).toContain('classically simulable with 𝔤-sim');
  });
  it('leaves other codes and already-soft wording alone', () => {
    expect(diagnosticMessage({ code: 'TRN001', message: old })).toBe(old);
    expect(diagnosticMessage({ code: 'TRN003', message: 'already soft' })).toBe('already soft');
  });
});
