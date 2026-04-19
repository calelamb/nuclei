import { describe, it, expect } from 'vitest';
import { classifyIntent } from './classify';

describe('classifyIntent', () => {
  it('routes explicit /compose prefix to compose', () => {
    expect(classifyIntent('/compose make a bell state').kind).toBe('compose');
  });

  it('routes /explain to explain', () => {
    expect(classifyIntent('/explain what does H do').kind).toBe('explain');
  });

  it('routes imperative code-gen phrasing to compose', () => {
    for (const s of [
      'create a 3-qubit GHZ state',
      'build me a bell circuit',
      'make a teleportation circuit',
      'write code for grover with 2 qubits',
      'generate a QFT on 4 qubits',
    ]) {
      expect(classifyIntent(s).kind, s).toBe('compose');
    }
  });

  it('leaves everything else as explain by default', () => {
    for (const s of [
      'what is entanglement?',
      'why is my circuit broken',
      'show me the bloch sphere for q0',
    ]) {
      expect(classifyIntent(s).kind, s).toBe('explain');
    }
  });

  it('strips the slash prefix from the returned prompt', () => {
    expect(classifyIntent('/compose make bell').prompt).toBe('make bell');
  });
});
