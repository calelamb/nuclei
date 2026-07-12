import { describe, it, expect } from 'vitest';
import {
  STIM_LANGUAGE_ID,
  STIM_GATES,
  STIM_NOISE_OPS,
  STIM_ANNOTATIONS,
  stimMonarchLanguage,
  stimLanguageConfiguration,
} from './stimLanguage';

describe('stimLanguage', () => {
  it('exposes the stim language id', () => {
    expect(STIM_LANGUAGE_ID).toBe('stim');
  });

  it('gates cover the instructions the generated QEC circuits use', () => {
    expect(STIM_GATES).toEqual(
      expect.arrayContaining(['H', 'CX', 'CNOT', 'M', 'MR', 'R', 'SWAP', 'REPEAT']),
    );
  });

  it('noise ops are their own distinct list (highlighted differently)', () => {
    expect(STIM_NOISE_OPS).toEqual(
      expect.arrayContaining(['X_ERROR', 'DEPOLARIZE1', 'DEPOLARIZE2', 'PAULI_CHANNEL_1']),
    );
    // Distinctness matters: a noise op must never fall through to the
    // gate token, or the hazard highlighting silently vanishes.
    for (const op of STIM_NOISE_OPS) {
      expect(STIM_GATES).not.toContain(op);
    }
  });

  it('annotations cover detector/observable markers and coordinates', () => {
    expect(STIM_ANNOTATIONS).toEqual(
      expect.arrayContaining(['DETECTOR', 'OBSERVABLE_INCLUDE', 'QUBIT_COORDS', 'SHIFT_COORDS', 'TICK']),
    );
    for (const a of STIM_ANNOTATIONS) {
      expect(STIM_GATES).not.toContain(a);
      expect(STIM_NOISE_OPS).not.toContain(a);
    }
  });

  it('Monarch definition wires the word lists and is case-insensitive like stim', () => {
    expect(stimMonarchLanguage.tokenizer?.root).toBeDefined();
    expect(stimMonarchLanguage.ignoreCase).toBe(true);
    expect(stimMonarchLanguage.gates).toEqual(STIM_GATES);
    expect(stimMonarchLanguage.noiseOps).toEqual(STIM_NOISE_OPS);
    expect(stimMonarchLanguage.annotations).toEqual(STIM_ANNOTATIONS);
  });

  it('uses # line comments', () => {
    expect(stimLanguageConfiguration.comments?.lineComment).toBe('#');
  });
});
