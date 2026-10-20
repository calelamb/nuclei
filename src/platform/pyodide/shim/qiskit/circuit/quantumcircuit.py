"""QuantumCircuit for the browser Qiskit subset (gates, measure, compose, ...)."""

from collections import namedtuple

import numpy as np

from _nuclei_unsupported import (
    unsupported, UnsupportedAttribute, is_real_circuit_attribute, unknown_circuit_attribute,
)
from qiskit.exceptions import QiskitError
from qiskit.circuit import gates as g
from qiskit.circuit.bits import (
    Clbit, ClassicalRegister, QuantumRegister, Qubit,
)

CircuitInstruction = namedtuple("CircuitInstruction", ["operation", "qubits", "clbits"])
BitLocations = namedtuple("BitLocations", ["index", "registers"])


class InstructionSet:
    """What gate methods return, so `qc.x(0).c_if(creg, 1)` keeps working."""

    def __init__(self, ops):
        self._ops = list(ops)

    def c_if(self, classical, val):
        for op in self._ops:
            op.condition = (classical, int(val))
        return self

    def __len__(self):
        return len(self._ops)

    def __getitem__(self, i):
        return self._ops[i]


class QuantumCircuit:
    def __init__(self, *regs, name=None, global_phase=0):
        self.name = name or "circuit"
        self.global_phase = global_phase
        self.qregs = []
        self.cregs = []
        self._qubits = []
        self._clbits = []
        self._qindex = {}
        self._cindex = {}
        self.data = []
        self.metadata = {}
        self._build_registers(regs)

    # ----- registers & bits ------------------------------------------------
    def _build_registers(self, regs):
        ints = [r for r in regs if isinstance(r, (int, np.integer))]
        if ints and len(ints) == len(regs):
            if len(ints) > 2:
                raise QiskitError("QuantumCircuit takes (num_qubits, num_clbits)")
            if ints[0] > 0:
                self.add_register(QuantumRegister(int(ints[0]), "q"))
            if len(ints) == 2 and ints[1] > 0:
                self.add_register(ClassicalRegister(int(ints[1]), "c"))
        elif ints:
            raise QiskitError("Cannot mix integer sizes and registers in QuantumCircuit()")
        else:
            self.add_register(*regs)

    def add_register(self, *regs):
        for reg in regs:
            if isinstance(reg, QuantumRegister):
                self.qregs.append(reg)
                for bit in reg:
                    self._qindex[id(bit)] = len(self._qubits)
                    self._qubits.append(bit)
            elif isinstance(reg, ClassicalRegister):
                self.cregs.append(reg)
                for bit in reg:
                    self._cindex[id(bit)] = len(self._clbits)
                    self._clbits.append(bit)
            else:
                raise QiskitError(f"Cannot add {reg!r} as a register")

    @property
    def qubits(self):
        return list(self._qubits)

    @property
    def clbits(self):
        return list(self._clbits)

    @property
    def num_qubits(self):
        return len(self._qubits)

    @property
    def num_clbits(self):
        return len(self._clbits)

    def find_bit(self, bit):
        table = self._qindex if isinstance(bit, Qubit) else self._cindex
        regs = self.qregs if isinstance(bit, Qubit) else self.cregs
        if id(bit) not in table:
            raise QiskitError(f"Bit {bit!r} is not in this circuit")
        return BitLocations(table[id(bit)], [(r, r[:].index(bit)) for r in regs if bit in r[:]])

    def _qubit_list(self, spec):
        if isinstance(spec, QuantumRegister):
            return list(spec)
        if isinstance(spec, slice):
            return self._qubits[spec]
        if isinstance(spec, (list, tuple, range, np.ndarray)):
            out = []
            for item in spec:
                out.extend(self._qubit_list(item))
            return out
        if isinstance(spec, Qubit):
            self.find_bit(spec)
            return [spec]
        if isinstance(spec, (int, np.integer)):
            if not -self.num_qubits <= spec < self.num_qubits:
                raise QiskitError(f"Qubit index {int(spec)} is out of range for {self.num_qubits} qubits")
            return [self._qubits[int(spec)]]
        raise QiskitError(f"Invalid qubit specifier {spec!r}")

    def _clbit_list(self, spec):
        if isinstance(spec, ClassicalRegister):
            return list(spec)
        if isinstance(spec, slice):
            return self._clbits[spec]
        if isinstance(spec, (list, tuple, range, np.ndarray)):
            out = []
            for item in spec:
                out.extend(self._clbit_list(item))
            return out
        if isinstance(spec, Clbit):
            self.find_bit(spec)
            return [spec]
        if isinstance(spec, (int, np.integer)):
            if not -self.num_clbits <= spec < self.num_clbits:
                raise QiskitError(f"Classical bit index {int(spec)} is out of range for {self.num_clbits} classical bits")
            return [self._clbits[int(spec)]]
        raise QiskitError(f"Invalid classical bit specifier {spec!r}")

    # ----- building --------------------------------------------------------
    def _push(self, op, qubits, clbits=()):
        self.data.append(CircuitInstruction(op, tuple(qubits), tuple(clbits)))
        return op

    def _broadcast(self, specs):
        lists = [self._qubit_list(s) for s in specs]
        size = max(len(item) for item in lists)
        for item in lists:
            if len(item) not in (1, size):
                raise QiskitError("Qubit arguments to a gate must broadcast to the same length")
        rows = [[item[i] if len(item) > 1 else item[0] for item in lists] for i in range(size)]
        for row in rows:
            if len({id(b) for b in row}) != len(row):
                raise QiskitError("Duplicate qubit arguments")
        return rows

    def _gate(self, gate_cls, qspecs, *params):
        ops = []
        for row in self._broadcast(qspecs):
            ops.append(self._push(gate_cls(*params), row))
        return InstructionSet(ops)

    def id(self, q): return self._gate(g.IGate, [q])
    i = id
    def h(self, q): return self._gate(g.HGate, [q])
    def x(self, q): return self._gate(g.XGate, [q])
    def y(self, q): return self._gate(g.YGate, [q])
    def z(self, q): return self._gate(g.ZGate, [q])
    def s(self, q): return self._gate(g.SGate, [q])
    def sdg(self, q): return self._gate(g.SdgGate, [q])
    def t(self, q): return self._gate(g.TGate, [q])
    def tdg(self, q): return self._gate(g.TdgGate, [q])
    def sx(self, q): return self._gate(g.SXGate, [q])
    def sxdg(self, q): return self._gate(g.SXdgGate, [q])
    def rx(self, theta, q): return self._gate(g.RXGate, [q], theta)
    def ry(self, theta, q): return self._gate(g.RYGate, [q], theta)
    def rz(self, phi, q): return self._gate(g.RZGate, [q], phi)
    def p(self, theta, q): return self._gate(g.PhaseGate, [q], theta)
    def u1(self, theta, q): return self._gate(g.U1Gate, [q], theta)
    def u(self, theta, phi, lam, q): return self._gate(g.UGate, [q], theta, phi, lam)
    def u3(self, theta, phi, lam, q): return self._gate(g.U3Gate, [q], theta, phi, lam)
    def cx(self, c, t): return self._gate(g.CXGate, [c, t])
    cnot = cx
    def cy(self, c, t): return self._gate(g.CYGate, [c, t])
    def cz(self, c, t): return self._gate(g.CZGate, [c, t])
    def ch(self, c, t): return self._gate(g.CHGate, [c, t])
    def cp(self, theta, c, t): return self._gate(g.CPhaseGate, [c, t], theta)
    def crx(self, theta, c, t): return self._gate(g.CRXGate, [c, t], theta)
    def cry(self, theta, c, t): return self._gate(g.CRYGate, [c, t], theta)
    def crz(self, theta, c, t): return self._gate(g.CRZGate, [c, t], theta)
    def swap(self, a, b): return self._gate(g.SwapGate, [a, b])
    def ccx(self, c1, c2, t): return self._gate(g.CCXGate, [c1, c2, t])
    toffoli = ccx
    def ccz(self, c1, c2, t): return self._gate(g.CCZGate, [c1, c2, t])
    def cswap(self, c, a, b): return self._gate(g.CSwapGate, [c, a, b])
    fredkin = cswap

    def mcx(self, control_qubits, target_qubit, **_ignored):
        controls = self._qubit_list(control_qubits)
        target = self._qubit_list(target_qubit)
        return InstructionSet([self._push(g.MCXGate(len(controls)), controls + target)])

    def measure(self, qubit, cbit):
        qs, cs = self._qubit_list(qubit), self._clbit_list(cbit)
        if len(qs) != len(cs):
            raise QiskitError("measure: qubit and classical bit arguments must have the same length")
        ops = [self._push(g.Measure(), [q], [c]) for q, c in zip(qs, cs)]
        return InstructionSet(ops)

    def measure_all(self, inplace=True, add_bits=True):
        target = self if inplace else self.copy()
        if add_bits:
            target.add_register(ClassicalRegister(target.num_qubits, "meas"))
            clbits = target._clbits[-target.num_qubits:]
        else:
            clbits = target._clbits[: target.num_qubits]
        target.barrier()
        for q, c in zip(target._qubits, clbits):
            target._push(g.Measure(), [q], [c])
        return None if inplace else target

    def barrier(self, *qargs, label=None):
        qubits = self._qubits if not qargs else self._qubit_list(list(qargs))
        return InstructionSet([self._push(g.Barrier(len(qubits)), qubits)])

    def reset(self, qubit):
        return InstructionSet([self._push(g.Reset(), [q]) for q in self._qubit_list(qubit)])

    def initialize(self, params, qubits=None, normalize=False):
        if isinstance(params, str):
            unsupported("QuantumCircuit.initialize() with a string label")
        amps = np.asarray(params, dtype=complex).ravel()
        if normalize:
            amps = amps / np.linalg.norm(amps)
        qs = self._qubits if qubits is None else self._qubit_list(qubits)
        op = g.Initialize(amps)
        if op.num_qubits != len(qs):
            raise QiskitError(f"initialize: {len(amps)} amplitudes need {op.num_qubits} qubits, got {len(qs)}")
        return InstructionSet([self._push(op, qs)])

    def unitary(self, obj, qubits, label=None):
        data = getattr(obj, "data", obj)
        op = g.UnitaryGate(data, label=label)
        return InstructionSet([self._push(op, self._qubit_list(qubits))])

    def append(self, instruction, qargs=None, cargs=None):
        if isinstance(instruction, QuantumCircuit):
            instruction = instruction.to_instruction()
        qs = self._qubit_list(qargs) if qargs is not None else []
        cs = self._clbit_list(cargs) if cargs is not None else []
        if len(qs) != instruction.num_qubits:
            raise QiskitError(
                f"append: '{instruction.name}' acts on {instruction.num_qubits} qubit(s), got {len(qs)}"
            )
        return InstructionSet([self._push(instruction.copy(), qs, cs)])

    # ----- composition ------------------------------------------------------
    def compose(self, other, qubits=None, clbits=None, front=False, inplace=False, **_ignored):
        if hasattr(other, "definition") and not isinstance(other, QuantumCircuit):
            other = other.definition
        if other.num_qubits > self.num_qubits:
            raise QiskitError("Trying to compose with a larger circuit")
        qmap = self._qubits[: other.num_qubits] if qubits is None else self._qubit_list(qubits)
        cmap = self._clbits[: other.num_clbits] if clbits is None else self._clbit_list(clbits)
        if len(qmap) != other.num_qubits or len(cmap) < other.num_clbits:
            raise QiskitError("compose: qubit/clbit mapping does not match the composed circuit")
        target = self if inplace else self.copy()
        new_data = [
            CircuitInstruction(
                i.operation.copy(),
                tuple(qmap[other.find_bit(q).index] for q in i.qubits),
                tuple(cmap[other.find_bit(c).index] for c in i.clbits),
            )
            for i in other.data
        ]
        target.data = (new_data + target.data) if front else (target.data + new_data)
        return None if inplace else target

    def copy(self, name=None):
        out = QuantumCircuit(name=name or self.name)
        out.qregs = list(self.qregs)
        out.cregs = list(self.cregs)
        out._qubits, out._clbits = list(self._qubits), list(self._clbits)
        out._qindex, out._cindex = dict(self._qindex), dict(self._cindex)
        out.data = [CircuitInstruction(i.operation.copy(), i.qubits, i.clbits) for i in self.data]
        out.global_phase = self.global_phase
        out.metadata = dict(self.metadata)
        return out

    def inverse(self):
        out = self.copy(name=f"{self.name}_dg")
        out.data = []
        for inst in reversed(self.data):
            op = inst.operation
            if op.name == "measure" or op.name == "reset":
                raise QiskitError(f"Cannot invert a circuit containing '{op.name}'")
            out.data.append(CircuitInstruction(op.inverse(), inst.qubits, inst.clbits))
        return out

    def to_instruction(self, label=None):
        return self._as_gate(label, g.Instruction)

    def to_gate(self, label=None):
        return self._as_gate(label, g.Gate)

    def _as_gate(self, label, base):
        name = self.name
        if base is g.Gate:
            op = g.Gate(name, self.num_qubits, [], label)
        else:
            op = g.Instruction(name, self.num_qubits, self.num_clbits, [], label)
        flat = QuantumCircuit(self.num_qubits, self.num_clbits if base is g.Instruction else 0, name=name)
        flat.data = [
            CircuitInstruction(
                i.operation.copy(),
                tuple(flat._qubits[self.find_bit(q).index] for q in i.qubits),
                tuple(flat._clbits[self.find_bit(c).index] for c in i.clbits),
            )
            for i in self.data
        ]
        op.definition = flat
        return op

    def decompose(self, *_args, **_kwargs):
        out = self.copy()
        out.data = []
        for inst in self.data:
            op = inst.operation
            defn = getattr(op, "definition", None)
            if defn is not None and op._matrix() is None:
                for sub in defn.data:
                    out.data.append(CircuitInstruction(
                        sub.operation.copy(),
                        tuple(inst.qubits[defn.find_bit(q).index] for q in sub.qubits),
                        tuple(inst.clbits[defn.find_bit(c).index] for c in sub.clbits) if inst.clbits else (),
                    ))
            else:
                out.data.append(inst)
        return out

    def remove_final_measurements(self, inplace=True):
        target = self if inplace else self.copy()
        blocked, keep = set(), []
        for inst in reversed(target.data):
            qids = {id(q) for q in inst.qubits}
            name = inst.operation.name
            if name in ("measure", "barrier") and not (qids & blocked):
                continue
            blocked |= qids
            keep.append(inst)
        target.data = list(reversed(keep))
        target._drop_idle_clbits()
        return None if inplace else target

    def _drop_idle_clbits(self):
        used = {id(c) for inst in self.data for c in inst.clbits}
        for inst in self.data:  # a classical condition keeps its bits alive
            used.update(id(b) for b in self.condition_bits(inst.operation))
        self.cregs = [r for r in self.cregs if any(id(b) in used for b in r)]
        keep = [b for b in self._clbits if id(b) in used]
        self._clbits = keep
        self._cindex = {id(b): i for i, b in enumerate(keep)}

    def _create_creg(self, length, name):
        return ClassicalRegister(length, name)

    def condition_bits(self, op):
        """Clbits a classically conditioned op depends on ([] when unconditioned)."""
        cond = getattr(op, "condition", None)
        if cond is None:
            return []
        target = cond[0]
        if isinstance(target, (int, np.integer)):
            return [self._clbits[int(target)]]
        return [target] if isinstance(target, Clbit) else list(target)

    # ----- inspection --------------------------------------------------------
    def __len__(self):
        return len(self.data)

    def size(self):
        return sum(1 for i in self.data if i.operation.name != "barrier")

    def width(self):
        return self.num_qubits + self.num_clbits

    def count_ops(self):
        counts = {}
        for inst in self.data:
            counts[inst.operation.name] = counts.get(inst.operation.name, 0) + 1
        return dict(sorted(counts.items(), key=lambda kv: -kv[1]))

    def num_nonlocal_gates(self):
        return sum(
            1 for i in self.data
            if len(i.qubits) > 1 and i.operation.name != "barrier"
        )

    def depth(self):
        levels = {}
        for inst in self.data:
            if inst.operation.name == "barrier":
                continue
            wires = [("q", id(q)) for q in inst.qubits] + [("c", id(c)) for c in inst.clbits]
            level = 1 + max((levels.get(w, 0) for w in wires), default=0)
            for w in wires:
                levels[w] = level
        return max(levels.values(), default=0)

    def draw(self, output="text", **_ignored):
        if output not in (None, "text"):
            unsupported(f"QuantumCircuit.draw(output={output!r})")
        from qiskit.circuit.textdraw import TextDrawing

        return TextDrawing(self)

    def __str__(self):
        return str(self.draw())

    def __repr__(self):
        return f"<QuantumCircuit {self.name!r} qubits={self.num_qubits} clbits={self.num_clbits} ops={len(self.data)}>"

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        if is_real_circuit_attribute(name):
            raise UnsupportedAttribute(f"QuantumCircuit.{name}()")
        raise unknown_circuit_attribute(self, name)
