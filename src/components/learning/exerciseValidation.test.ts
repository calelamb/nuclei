import { describe, expect, it } from 'vitest';
import { isQuantumCode, shouldAutoGrade, validateExerciseResult, validateExerciseRun } from './exerciseValidation';

const baseResult = {
  state_vector: [],
  probabilities: { '00': 0.5, '11': 0.5 },
  measurements: { '00': 512, '11': 512 },
  bloch_coords: [],
  execution_time_ms: 1,
  shot_count: 1024,
};

describe('exerciseValidation', () => {
  it('detects quantum code heuristically', () => {
    expect(isQuantumCode('from qiskit import QuantumCircuit')).toBe(true);
    expect(isQuantumCode("print('hello')")).toBe(false);
  });

  it('validates expected probabilities and rejects unexpected mass', () => {
    const validation = validateExerciseResult(
      {
        ...baseResult,
        probabilities: { '00': 0.5, '11': 0.4, '01': 0.1 },
      },
      {
        expectedProbabilities: { '00': 0.5, '11': 0.5 },
        tolerancePercent: 5,
      },
    );

    expect(validation?.success).toBe(false);
    expect(validation?.message).toContain('Unexpected');
  });

  it('validates measurement expectations as normalized distributions', () => {
    const validation = validateExerciseResult(baseResult, {
      expectedMeasurements: { '00': 100, '11': 100 },
      tolerancePercent: 5,
    });

    expect(validation).toEqual({
      success: true,
      message: 'Solution matches the expected distribution.',
    });
  });
});

describe('shouldAutoGrade (LR-15)', () => {
  it('does not grade an untouched starter, ignoring whitespace at the ends', () => {
    expect(shouldAutoGrade('qc.h(0)\n', 'qc.h(0)')).toBe(false);
  });
  it('grades once the learner has changed the code', () => {
    expect(shouldAutoGrade('qc.x(0)', 'qc.h(0)')).toBe(true);
  });
});

describe('validateExerciseRun', () => {
  const starter = '# TODO: Print 42\n';
  const base = { result: null, output: [] as string[], code: starter, starterCode: starter, tolerancePercent: 0 };

  it('never passes an untouched starter, even when the output would match', () => {
    const v = validateExerciseRun({ ...base, output: ['42'] }, { expectedOutput: ['42'] });
    expect(v.success).toBe(false);
  });

  it('passes when printed output matches every expected pattern', () => {
    const v = validateExerciseRun(
      { ...base, code: 'print(42)', output: ['hello', '42'] },
      { expectedOutput: ['hello', '\\b42\\b'] },
    );
    expect(v.success).toBe(true);
  });

  it('fails when the output misses a pattern', () => {
    const v = validateExerciseRun({ ...base, code: 'print(41)', output: ['41'] }, { expectedOutput: ['\\b42\\b'] });
    expect(v.success).toBe(false);
    expect(v.message).toMatch(/output/i);
  });

  it('ignores required patterns that only appear in comments', () => {
    const v = validateExerciseRun(
      { ...base, code: '# qc.h(0)\nx = 1', output: [] },
      { requiredCode: ['\\.h\\(0\\)'] },
    );
    expect(v.success).toBe(false);
  });

  it('passes required code found outside comments', () => {
    const v = validateExerciseRun({ ...base, code: 'qc.h(0)  # superpose', output: [] }, { requiredCode: ['\\.h\\(0\\)'] });
    expect(v.success).toBe(true);
  });

  it('treats an invalid pattern as a failed check, not a crash', () => {
    const v = validateExerciseRun({ ...base, code: 'x', output: ['x'] }, { expectedOutput: ['('] });
    expect(v.success).toBe(false);
  });

  it('still grades distributions', () => {
    const v = validateExerciseRun(
      { ...base, code: 'qc.h(0)', result: { ...baseResult, probabilities: { '0': 0.5, '1': 0.5 } }, tolerancePercent: 5 },
      { expectedProbabilities: { '0': 0.5, '1': 0.5 } },
    );
    expect(v.success).toBe(true);
  });

  it('fails a distribution exercise that has no simulation result', () => {
    const v = validateExerciseRun({ ...base, code: 'qc.h(0)' }, { expectedProbabilities: { '0': 1 } });
    expect(v.success).toBe(false);
  });
});
