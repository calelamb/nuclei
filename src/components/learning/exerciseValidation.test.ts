import { describe, expect, it } from 'vitest';
import { isQuantumCode, validateExerciseResult } from './exerciseValidation';

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
