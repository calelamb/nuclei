"""Shared helpers for the browser-only Qiskit compatibility subset.

The browser build ships a small, honest subset of Qiskit (see qiskit/__init__).
Anything outside that subset raises UnsupportedInBrowser with a message that
points the student at the desktop app instead of failing with a confusing
AttributeError deep inside the shim.
"""

import difflib
import importlib

from _qiskit_api import MODULE_API, QUANTUM_CIRCUIT_API

DESKTOP_HINT = "Open this in the Nuclei desktop app (getnuclei.dev) to run it with full Qiskit."


class UnsupportedInBrowser(NotImplementedError):
    """Raised for Qiskit features that the browser subset does not implement."""

    def __init__(self, feature):
        self.feature = feature
        super().__init__(
            f"{feature} isn't available in the browser version of Qiskit "
            f"(Qiskit browser subset). {DESKTOP_HINT}"
        )


class UnsupportedAttribute(UnsupportedInBrowser, AttributeError):
    """Instance-attribute flavour: hasattr()/getattr(default) keep working."""


def unsupported(feature):
    """Raise UnsupportedInBrowser for `feature`."""
    raise UnsupportedInBrowser(feature)


def did_you_mean(name, candidates):
    """Python-style ' Did you mean: 'h'?' suffix for the closest candidate, or ''."""
    close = difflib.get_close_matches(name, sorted(candidates), n=1, cutoff=0.6)
    return f" Did you mean: '{close[0]}'?" if close else ""


def unknown_circuit_attribute(owner, name):
    """AttributeError for a name real Qiskit does not have either: a typo, not a limit."""
    known = {n for n in dir(type(owner)) if not n.startswith("_")} | QUANTUM_CIRCUIT_API
    return AttributeError(
        f"'QuantumCircuit' object has no attribute '{name}'.{did_you_mean(name, known)}"
    )


def is_real_circuit_attribute(name):
    return name in QUANTUM_CIRCUIT_API


def make_getattr(module_name):
    """Build a module-level __getattr__.

    Real Qiskit names we do not implement raise UnsupportedInBrowser; anything
    else is a typo and gets a plain AttributeError with a suggestion.
    """

    def __getattr__(name):
        if name.startswith("_"):
            raise AttributeError(name)
        try:  # `from qiskit import quantum_info` must still reach real submodules
            return importlib.import_module(f"{module_name}.{name}")
        except ImportError:
            pass
        real = MODULE_API.get(module_name)
        if real is not None and name not in real:
            module = importlib.import_module(module_name)
            known = {n for n in vars(module) if not n.startswith("_")} | real
            # CPython (3.12+) appends its own "Did you mean" to module AttributeErrors
            # and ImportErrors, drawn from dir(module): make the real names visible
            # there instead of formatting a second suggestion ourselves.
            module.__dict__["__dir__"] = lambda: sorted(known)
            raise AttributeError(
                f"module '{module_name}' has no attribute '{name}'", name=name, obj=module
            ) from None
        raise UnsupportedInBrowser(f"{module_name}.{name}") from None

    return __getattr__
