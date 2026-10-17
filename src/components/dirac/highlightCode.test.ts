import { describe, expect, it } from 'vitest';
import { highlightCode } from './highlightCode';

const kinds = (code: string) => highlightCode(code).filter((t) => t.kind !== 'plain').map((t) => `${t.kind}:${t.text}`);

describe('highlightCode', () => {
  it('marks Python keywords, strings, numbers and comments', () => {
    expect(kinds("from qiskit import QuantumCircuit  # build\nqc = QuantumCircuit(2, 2)\nqc.rz(0.5, 'q')")).toEqual([
      'keyword:from', 'keyword:import', 'comment:# build', 'number:2', 'number:2', 'number:0.5', "string:'q'",
    ]);
  });

  it('handles Q# line comments and keywords', () => {
    expect(kinds('operation Bell() : Unit { // entangle\n use q = Qubit(); }')).toEqual(['keyword:operation', 'comment:// entangle', 'keyword:use']);
  });

  it('never drops or duplicates text', () => {
    const code = 'qc.h(0)  # Hadamard\nprint("|0⟩ ->", 1e-3)\n';
    expect(highlightCode(code).map((t) => t.text).join('')).toBe(code);
  });

  it('does not treat identifiers that merely contain a keyword as keywords', () => {
    expect(kinds('format = importer')).toEqual([]);
  });
});
