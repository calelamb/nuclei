"""Shared helpers for the browser-only Qiskit compatibility subset.

The browser build ships a small, honest subset of Qiskit (see qiskit/__init__).
Anything outside that subset raises UnsupportedInBrowser with a message that
points the student at the desktop app instead of failing with a confusing
AttributeError deep inside the shim.
"""

import importlib

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


def make_getattr(module_name):
    """Build a module-level __getattr__ that reports unsupported names."""

    def __getattr__(name):
        if name.startswith("_"):
            raise AttributeError(name)
        try:  # `from qiskit import quantum_info` must still reach real submodules
            return importlib.import_module(f"{module_name}.{name}")
        except ImportError:
            raise UnsupportedInBrowser(f"{module_name}.{name}") from None

    return __getattr__
