import { describe, it, expect } from 'vitest';
import {
  QSHARP_LANGUAGE_ID,
  QSHARP_KEYWORDS,
  QSHARP_TYPES,
  QSHARP_CONSTANTS,
  qsharpMonarchLanguage,
  qsharpLanguageConfiguration,
} from './qsharpLanguage';

describe('qsharpLanguage', () => {
  it('exposes the qsharp language id', () => {
    expect(QSHARP_LANGUAGE_ID).toBe('qsharp');
  });

  it('keywords cover the core Q# declaration and binding forms', () => {
    expect(QSHARP_KEYWORDS).toEqual(
      expect.arrayContaining(['operation', 'function', 'namespace', 'use', 'let', 'mutable']),
    );
  });

  it('types cover the Q# built-ins', () => {
    expect(QSHARP_TYPES).toEqual(
      expect.arrayContaining(['Qubit', 'Result', 'Unit', 'Int', 'Double', 'Bool']),
    );
  });

  it('constants cover Result and Pauli literals', () => {
    expect(QSHARP_CONSTANTS).toEqual(
      expect.arrayContaining(['Zero', 'One', 'PauliX', 'true', 'false']),
    );
  });

  it('Monarch definition has a root tokenizer state wired to the word lists', () => {
    expect(qsharpMonarchLanguage.tokenizer).toBeDefined();
    expect(qsharpMonarchLanguage.tokenizer.root).toBeDefined();
    expect(Array.isArray(qsharpMonarchLanguage.tokenizer.root)).toBe(true);
    // The cases-based identifier rule depends on these attributes existing.
    expect(qsharpMonarchLanguage.keywords).toEqual(QSHARP_KEYWORDS);
    expect(qsharpMonarchLanguage.typeKeywords).toEqual(QSHARP_TYPES);
    expect(qsharpMonarchLanguage.constants).toEqual(QSHARP_CONSTANTS);
  });

  it('Monarch definition has string states for plain and interpolated strings', () => {
    expect(qsharpMonarchLanguage.tokenizer.string).toBeDefined();
    expect(qsharpMonarchLanguage.tokenizer.interpolatedString).toBeDefined();
  });

  it('interpolation holes track nested braces via a push/pop interpolationHole state', () => {
    const tokenizer = qsharpMonarchLanguage.tokenizer;
    expect(tokenizer.interpolationHole).toBeDefined();

    // `{` inside an interpolated string enters the hole state...
    const interpActions = JSON.stringify(tokenizer.interpolatedString);
    expect(interpActions).toContain('@interpolationHole');

    // ...and the hole state pushes itself on nested `{` and pops on `}`,
    // so depth is carried by the Monarch state stack.
    const holeActions = JSON.stringify(tokenizer.interpolationHole);
    expect(holeActions).toContain('@interpolationHole');
    expect(holeActions).toContain('@pop');
  });

  it('language configuration uses // line comments and auto-closes brackets + quotes', () => {
    expect(qsharpLanguageConfiguration.comments?.lineComment).toBe('//');
    const pairs = (qsharpLanguageConfiguration.autoClosingPairs ?? []).map(
      (p) => `${p.open}${p.close}`,
    );
    expect(pairs).toEqual(expect.arrayContaining(['{}', '[]', '()', '""']));
  });
});
