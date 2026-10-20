"""Total gate-parameter description for the Qiskit snapshot (PRD 15 R-13).

A gate's ``params`` are not always angles: ``initialize`` carries complex
amplitudes (or a basis-state string), ``unitary`` a matrix, ``if_test`` a
circuit. None of those is a float, and none may stop the diagram from
drawing. Each becomes ``0.0`` plus a descriptive label in ``symbols``.
"""

from __future__ import annotations

import numpy as np

UNAVAILABLE_LABEL = "<unavailable>"


def _array_label(array: np.ndarray) -> str:
    if array.ndim == 2:
        return f"<unitary {array.shape[0]}x{array.shape[1]}>"
    return "<array " + "x".join(str(n) for n in array.shape) + ">"


def params_and_symbols(op) -> tuple[list[float], list[str | None]]:
    """Numeric params plus parallel symbol names.

    A parameter that still has free symbols is emitted as ``0.0`` with its
    symbol name (a bare ``Parameter``) or expression text; bound or numeric
    values are emitted as floats with a ``None`` symbol. Values that are not
    real numbers become ``0.0`` with a label: all of an op's complex
    amplitudes collapse to one ``<complex[N]>``, its string params to one
    ``<'01'>``, a matrix to ``<unitary RxC>``, a nested circuit to
    ``<block>``. ``None`` placeholders (an absent ``else`` branch) are dropped.
    """
    from qiskit import QuantumCircuit
    from qiskit.circuit import Parameter

    params: list[float] = []
    symbols: list[str | None] = []
    complex_count = 0
    text: list[str] = []

    def labelled(label: str) -> None:
        params.append(0.0)
        symbols.append(label)

    for p in op.params or []:
        if p is None:
            continue
        if isinstance(p, QuantumCircuit):
            labelled("<block>")
        elif isinstance(p, np.ndarray):
            labelled(_array_label(p))
        elif isinstance(p, str):
            text.append(p)
        elif isinstance(p, (complex, np.complexfloating)):
            complex_count += 1
        elif getattr(p, "parameters", None):
            labelled(p.name if isinstance(p, Parameter) else str(p))
        else:
            try:
                params.append(float(p))
                symbols.append(None)
            except (TypeError, ValueError):
                labelled(f"<{type(p).__name__}>")

    if complex_count:
        labelled(f"<complex[{complex_count}]>")
    if text:
        labelled(f"<'{''.join(text)}'>")
    return params, symbols
