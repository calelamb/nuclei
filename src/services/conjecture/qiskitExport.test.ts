import { describe, expect, it } from 'vitest';
import { FIXTURE_IR } from './fixtures';
import { irToQiskitProgram } from './qiskitExport';

const META = { conjectureId: 'cj-1', statement: 'Brick CZ circuits stay trainable.', seed: 1002, familyParams: { pattern: 'brick', layers: 6 } };

describe('irToQiskitProgram', () => {
  it('rebuilds the IR gate list as a Qiskit program (snapshot)', () => {
    const res = irToQiskitProgram(FIXTURE_IR, META);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.code).toMatchSnapshot();
  });

  it('maps every gate to the right method, angle expression and qubit order', () => {
    const res = irToQiskitProgram(FIXTURE_IR, META);
    if (!res.ok) throw new Error(res.error);
    expect(res.gates).toBe(8);
    expect(res.code).toContain('qc.h(0)');
    expect(res.code).toContain('qc.ry(params["t0"], 0)');
    expect(res.code).toContain('qc.rz((2.0 * params["t1"] + 0.5), 1)');
    expect(res.code).toContain('qc.cz(0, 1)');
    expect(res.code).toContain('qc.cx(1, 2)');
    expect(res.code).toContain('qc.rz(0.25, 0)');
  });

  it('handles controlled and two-qubit rotations', () => {
    const ir = { n_qubits: 2, parameters: ['a'], gates: [
      { name: 'CRX', qubits: [0, 1], angles: [{ param: 'a', coeff: 1, offset: 0 }] },
      { name: 'RZZ', qubits: [0, 1], angles: [0.5] },
      { name: 'U', qubits: [1], angles: [0.1, 0.2, 0.3] },
      { name: 'SDG', qubits: [0], angles: [] },
    ] };
    const res = irToQiskitProgram(ir, META);
    if (!res.ok) throw new Error(res.error);
    expect(res.code).toContain('qc.crx(params["a"], 0, 1)');
    expect(res.code).toContain('qc.rzz(0.5, 0, 1)');
    expect(res.code).toContain('qc.u(0.1, 0.2, 0.3, 1)');
    expect(res.code).toContain('qc.sdg(0)');
  });

  it('fails clearly on a missing IR, unknown gate or out-of-range qubit', () => {
    expect(irToQiskitProgram(null, META)).toEqual({ ok: false, error: 'The counterexample has no circuit IR.' });
    expect(irToQiskitProgram({ n_qubits: 1, gates: [{ name: 'FOO', qubits: [0] }] }, META)).toMatchObject({ ok: false });
    expect(irToQiskitProgram({ n_qubits: 1, gates: [{ name: 'H', qubits: [3] }] }, META)).toMatchObject({ ok: false });
  });

  it('keeps hostile statement text from breaking the docstring', () => {
    const res = irToQiskitProgram(FIXTURE_IR, { ...META, statement: 'x """ import os' });
    if (!res.ok) throw new Error(res.error);
    expect(res.code.split('"""')).toHaveLength(3);
  });
});
