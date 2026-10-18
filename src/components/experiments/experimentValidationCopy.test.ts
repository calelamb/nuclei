import { describe, it, expect } from 'vitest';
import { explainValidationMessage, problemCountLabel } from './experimentValidationCopy';

describe('explainValidationMessage', () => {
  it('turns a missing field into a sentence', () => {
    expect(explainValidationMessage('seed: Invalid input: expected number, received undefined'))
      .toBe('“seed” is required but missing.');
  });

  it('turns a type mismatch into a sentence', () => {
    expect(explainValidationMessage('backend: Invalid input: expected object, received string'))
      .toBe('“backend” should be a group of fields, not plain text.');
  });

  it('passes through messages it does not recognise', () => {
    expect(explainValidationMessage('sweep expands to 900 points')).toBe('sweep expands to 900 points');
  });
});

describe('problemCountLabel', () => {
  it('pluralises', () => {
    expect(problemCountLabel(1)).toBe('1 problem');
    expect(problemCountLabel(4)).toBe('4 problems');
  });
});
