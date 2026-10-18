/**
 * Counterexample IR to a Qiskit program. The kernel's IR (`ParamCircuit.to_json`)
 * is a gate list: `{name, qubits, angles}` where an angle is a number or
 * `{param, coeff, offset}`. This emits a standalone, readable script with a
 * `build()` entry that rebuilds the circuit with free `Parameter`s.
 */

const FIXED: Readonly<Record<string, string>> = {
  I: 'id', H: 'h', X: 'x', Y: 'y', Z: 'z', S: 's', SDG: 'sdg', T: 't', TDG: 'tdg', SX: 'sx', SXDG: 'sxdg',
  CX: 'cx', CY: 'cy', CZ: 'cz', CH: 'ch', SWAP: 'swap', ISWAP: 'iswap', CCX: 'ccx', CCZ: 'ccz', CSWAP: 'cswap',
};
const ANGLED: Readonly<Record<string, { method: string; angles: number }>> = {
  RX: { method: 'rx', angles: 1 }, RY: { method: 'ry', angles: 1 }, RZ: { method: 'rz', angles: 1 },
  P: { method: 'p', angles: 1 }, U: { method: 'u', angles: 3 },
  RXX: { method: 'rxx', angles: 1 }, RYY: { method: 'ryy', angles: 1 }, RZZ: { method: 'rzz', angles: 1 }, RZX: { method: 'rzx', angles: 1 },
  CRX: { method: 'crx', angles: 1 }, CRY: { method: 'cry', angles: 1 }, CRZ: { method: 'crz', angles: 1 }, CP: { method: 'cp', angles: 1 },
};

export interface ProgramMeta {
  conjectureId: string;
  statement: string;
  seed: number | null;
  familyParams: Record<string, unknown>;
}

export type ProgramResult = { ok: true; code: string; gates: number } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const pyString = (s: string) => JSON.stringify(s);
const comment = (s: string) => s.replace(/"""/g, "'''").replace(/\s+/g, ' ').trim();

function pyNumber(n: number): string {
  return Number.isInteger(n) && Math.abs(n) < 1e15 ? `${n}.0` : String(n);
}

function angleExpr(angle: unknown, where: string): string {
  if (typeof angle === 'number' && Number.isFinite(angle)) return pyNumber(angle);
  if (isObject(angle) && typeof angle.param === 'string') {
    const coeff = typeof angle.coeff === 'number' ? angle.coeff : 1;
    const offset = typeof angle.offset === 'number' ? angle.offset : 0;
    if (!Number.isFinite(coeff) || !Number.isFinite(offset)) throw new Error(`${where}: non-finite angle`);
    const ref = `params[${pyString(angle.param)}]`;
    const scaled = coeff === 1 ? ref : `${pyNumber(coeff)} * ${ref}`;
    return offset === 0 ? scaled : `(${scaled} + ${pyNumber(offset)})`;
  }
  throw new Error(`${where}: unsupported angle`);
}

function gateLine(raw: unknown, index: number, n: number): string {
  const where = `gate ${index}`;
  if (!isObject(raw) || typeof raw.name !== 'string') throw new Error(`${where}: missing name`);
  const qubits = raw.qubits;
  if (!Array.isArray(qubits) || !qubits.every((q) => Number.isInteger(q) && q >= 0 && q < n)) {
    throw new Error(`${where}: qubits out of range for ${n} qubits`);
  }
  const angles = Array.isArray(raw.angles) ? raw.angles : [];
  const fixed = FIXED[raw.name];
  if (fixed) return `    qc.${fixed}(${qubits.join(', ')})`;
  const spec = ANGLED[raw.name];
  if (!spec) throw new Error(`${where}: gate ${raw.name} has no Qiskit mapping`);
  if (angles.length !== spec.angles) throw new Error(`${where}: ${raw.name} needs ${spec.angles} angle(s)`);
  return `    qc.${spec.method}(${[...angles.map((a) => angleExpr(a, where)), ...qubits].join(', ')})`;
}

export function irToQiskitProgram(ir: unknown, meta: ProgramMeta): ProgramResult {
  if (!isObject(ir)) return { ok: false, error: 'The counterexample has no circuit IR.' };
  const n = ir.n_qubits;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return { ok: false, error: 'The IR has no valid n_qubits.' };
  if (!Array.isArray(ir.gates)) return { ok: false, error: 'The IR has no gate list.' };
  let lines: string[];
  try {
    lines = ir.gates.map((g, i) => gateLine(g, i, n));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const names = Array.isArray(ir.parameters) ? ir.parameters.filter((p): p is string => typeof p === 'string') : [];
  const family = comment(JSON.stringify(meta.familyParams));
  const code = [
    '"""',
    `Counterexample to conjecture ${comment(meta.conjectureId)}.`,
    '',
    comment(meta.statement),
    '',
    `Kernel seed: ${meta.seed ?? 'unknown'}. Family parameters: ${family}.`,
    `Rebuilt by Nuclei's Conjecture Engine from the kernel IR: ${n} qubits, ${lines.length} gates, ${names.length} parameters.`,
    '"""',
    'from qiskit import QuantumCircuit',
    'from qiskit.circuit import Parameter',
    '',
    `N_QUBITS = ${n}`,
    `PARAMETER_NAMES = [${names.map(pyString).join(', ')}]`,
    '',
    '',
    'def build() -> QuantumCircuit:',
    '    qc = QuantumCircuit(N_QUBITS)',
    '    params = {name: Parameter(name) for name in PARAMETER_NAMES}',
    ...lines,
    '    return qc',
    '',
    '',
    'if __name__ == "__main__":',
    '    print(build())',
    '',
  ].join('\n');
  return { ok: true, code, gates: lines.length };
}
