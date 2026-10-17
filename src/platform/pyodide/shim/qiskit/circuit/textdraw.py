"""Plain-text circuit drawing for the browser Qiskit subset (one row per qubit)."""

_CONTROL, _LINK = "■", "│"


def _label(op):
    name = op.name.upper()
    if op.params and len(op.params) <= 3:
        return f"{name}({','.join(f'{p:.3g}' for p in op.params)})"
    return name


def _layer_columns(circuit):
    """Greedy columns: each gate goes in the first column free on all its qubit rows."""
    columns, busy_until = [], {}
    for inst in circuit.data:
        idxs = [circuit.find_bit(q).index for q in inst.qubits]
        lo, hi = min(idxs), max(idxs)
        col = max((busy_until.get(i, 0) for i in range(lo, hi + 1)), default=0)
        for i in range(lo, hi + 1):
            busy_until[i] = col + 1
        while len(columns) <= col:
            columns.append([])
        columns[col].append((inst, idxs))
    return columns


def _cell_text(inst, idxs, row):
    name = inst.operation.name
    if name == "barrier":
        return "░"
    if name == "measure":
        return "M"
    if name == "swap":
        return "x" if row in idxs else _LINK
    if row not in idxs:
        return _LINK
    pos = idxs.index(row)
    n_controls = {"cx": 1, "cy": 1, "cz": 1, "ch": 1, "cp": 1, "crx": 1, "cry": 1, "crz": 1,
                  "ccx": 2, "ccz": 2, "cswap": 1}.get(name, inst.operation.num_qubits - 1 if name == "mcx" else 0)
    if pos < n_controls:
        return _CONTROL
    if name in ("cx", "ccx", "mcx"):
        return "X"
    if name.startswith("c") and len(idxs) > 1 and name in ("cy", "cz", "ch", "cp", "crx", "cry", "crz", "ccz"):
        return _label(inst.operation)[1:] if name != "ccz" else "Z"
    return _label(inst.operation)


class TextDrawing:
    def __init__(self, circuit):
        self._circuit = circuit

    def __str__(self):
        c = self._circuit
        labels = [f"q_{i}: " for i in range(c.num_qubits)]
        width = max((len(s) for s in labels), default=0)
        rows = [s.ljust(width) + "─" for s in labels]
        for column in _layer_columns(c):
            cells = []
            for row in range(c.num_qubits):
                text = "─"
                for inst, idxs in column:
                    if min(idxs) <= row <= max(idxs):
                        text = _cell_text(inst, idxs, row)
                cells.append(text)
            w = max(len(t) for t in cells) if cells else 1
            for row in range(c.num_qubits):
                rows[row] += cells[row].center(w, "─") + "──"
        return "\n".join(rows)

    __repr__ = __str__
