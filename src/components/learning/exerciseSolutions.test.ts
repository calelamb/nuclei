import { describe, it, expect } from 'vitest';
import { TRACKS } from '../../data/lessons/tracks';
import type { ExerciseBlock } from '../../data/lessons/types';
import { validateExerciseRun } from './exerciseValidation';

function findExercise(id: string): ExerciseBlock {
  for (const track of TRACKS) {
    for (const lesson of track.lessons) {
      for (const block of lesson.contentBlocks) {
        if (block.type === 'exercise' && block.id === id) return block;
      }
    }
  }
  throw new Error(`exercise ${id} not found`);
}

function grade(id: string, code: string, output: string[]) {
  const ex = findExercise(id);
  return validateExerciseRun(
    { result: null, output, code, starterCode: ex.starterCode, tolerancePercent: ex.tolerancePercent },
    ex,
  );
}

describe('exercise grading accepts honest solutions and rejects near misses', () => {
  const vqe = 'qc = QuantumCircuit(2)\nqc.ry(3.4, 0)\nqc.ry(3.1416, 1)\nqc.cx(0, 1)\n';

  it('7.3 needs to beat Hartree-Fock (-1.837 Ha), not just the untouched state', () => {
    expect(grade('7.3-ex1', vqe, ['Energy: -1.8566 Ha']).success).toBe(true);
    expect(grade('7.3-ex1', vqe, ['Energy: -1.0635 Ha']).success).toBe(false);
    expect(grade('7.3-ex1', vqe, ['Energy: -1.8369 Ha']).success).toBe(false);
  });

  it('5.35 grades on the printed threshold, whatever form the one-liner takes', () => {
    const out = ['c =   50  →  threshold ≈ 0.0200'];
    expect(grade('5.35-ex1', 'def threshold(c):\n    return 1.0 / c\n', out).success).toBe(true);
    expect(grade('5.35-ex1', 'def threshold(c):\n    t = 1 / float(c)\n    return t\n', out).success).toBe(true);
    expect(grade('5.35-ex1', 'def threshold(c):\n    return 1 / c\n', ['c =   50  →  threshold ≈ 0.5000']).success).toBe(false);
  });

  it('4.6 accepts any gate that prepares (|0> + i|1>)/sqrt2', () => {
    const rest = 'qc.cx(1, 2)\nqc.cx(0, 1)\nqc.h(0)\nqc.measure(0, 0)\nqc.measure(1, 1)\n';
    expect(grade('4.6-ex1', `qc.h(0)\nqc.s(0)\n${rest}`, []).success).toBe(true);
    expect(grade('4.6-ex1', `qc.h(0)\nqc.p(pi/2, 0)\n${rest}`, []).success).toBe(true);
    expect(grade('4.6-ex1', `qc.h(0)\n${rest}`, []).success).toBe(false);
  });

  it('12.4 and 8.1 accept a real solution', () => {
    const t = 'qc.h(0)\nqc.ccx(0,1,3)\nqc.cx(0,3)\nqc.cx(1,2)\nt = transpile(qc, backend, optimization_level=3)\nprint(qc.depth(), t.depth())\n';
    expect(grade('12.4-ex1', t, ['orig 3 4', 't 14 22']).success).toBe(true);
    expect(grade('12.4-ex1', t, ['depth 14']).success).toBe(false);
    const eve = 'ev = 1\nif eve_bases[i] == "X":\n    qc.h(0)\nqc.measure(0, 0)\nqc.measure(0, 0)\n';
    expect(grade('8.1-ex1', eve, ['Error rate: 22.2%']).success).toBe(true);
  });
});
