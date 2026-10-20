import { describe, expect, it } from 'vitest';
import { advance, arrowAngle, initialState, tally, MANY_SHOTS } from './playgroundModel';

const always = (v: number) => () => v;
const sequence = (...vs: number[]) => { let i = 0; return () => vs[i++ % vs.length]; };

describe('playground model', () => {
  it('starts on a qubit at |0>', () => {
    expect(initialState()).toMatchObject({ step: 0, qubit: 'zero', lastOutcome: null, shots: [], pair: null });
  });

  it('H puts the qubit in superposition and advances', () => {
    const s = advance(initialState(), 'apply_h', always(0));
    expect(s).toMatchObject({ qubit: 'superposition', step: 1 });
  });

  it('a single measurement records the outcome the arrow must show', () => {
    const one = advance(advance(initialState(), 'apply_h', always(0)), 'measure', always(0.9));
    expect(one).toMatchObject({ qubit: 'measured', lastOutcome: 1, shots: [1] });
    const zero = advance(advance(initialState(), 'apply_h', always(0)), 'measure', always(0.1));
    expect(zero).toMatchObject({ lastOutcome: 0, shots: [0] });
  });

  it('measure-many takes exactly 10 shots (never 10 added to the earlier one)', () => {
    const afterOne = advance(advance(initialState(), 'apply_h', always(0)), 'measure', always(0.9));
    const many = advance(afterOne, 'measure_many', sequence(0.9, 0.1));
    expect(many.shots).toHaveLength(MANY_SHOTS);
    expect(tally(many.shots)).toEqual({ zeros: 5, ones: 5, total: 10 });
    expect(many.lastOutcome).toBe(many.shots[many.shots.length - 1]);
  });

  it('entangling runs joint shots that only ever read |00> or |11>', () => {
    const s = advance(advance(initialState(), 'measure_many', sequence(0.9, 0.1, 0.1)), 'entangle', sequence(0.9, 0.1, 0.1));
    expect(s.pair).not.toBeNull();
    expect(s.pair!.counts['00'] + s.pair!.counts['11']).toBe(MANY_SHOTS);
    expect(Object.keys(s.pair!.counts).sort()).toEqual(['00', '11']);
    expect(s.pair!.last === 0 || s.pair!.last === 1).toBe(true);
  });

  it('both entangled arrows follow the same last outcome', () => {
    const s = advance(initialState(), 'entangle', always(0.9));
    expect(s.pair!.last).toBe(1);
    expect(arrowAngle('measured', s.pair!.last)).toBe(90);
  });

  it('draws the arrow at the measured outcome, never always |0>', () => {
    expect(arrowAngle('measured', 1)).toBe(90);
    expect(arrowAngle('measured', 0)).toBe(-90);
    expect(arrowAngle('zero', null)).toBe(-90);
    expect(arrowAngle('superposition', null)).toBe(0);
  });

  it('bridge marks the playground as bridging without changing the step', () => {
    const s = advance({ ...initialState(), step: 5 }, 'bridge', always(0));
    expect(s.bridging).toBe(true);
    expect(s.step).toBe(5);
  });

  it('null action (Continue) just advances', () => {
    expect(advance(initialState(), null, always(0)).step).toBe(1);
  });
});
