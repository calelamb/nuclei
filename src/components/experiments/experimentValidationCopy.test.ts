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

  it('explains numeric bounds', () => {
    expect(explainValidationMessage('shots: Too small: expected number to be >0')).toBe('“shots” must be greater than 0.');
    expect(explainValidationMessage('depth: Too big: expected number to be <=64')).toBe('“depth” must be at most 64.');
    expect(explainValidationMessage('name: Too small: expected string to have >=1 characters')).toBe('“name” must be at least 1 character.');
  });

  it('explains a bare invalid value and a bad option', () => {
    expect(explainValidationMessage('sweep.theta: Invalid input')).toBe('“sweep.theta” has a value the experiment format does not accept.');
    expect(explainValidationMessage('mode: Invalid option: expected one of "a"|"b"')).toBe('“mode” must be one of "a"|"b".');
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
