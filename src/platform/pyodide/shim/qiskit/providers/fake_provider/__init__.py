"""Unsupported in the browser Qiskit subset - every name reports a desktop hint."""
from _nuclei_unsupported import make_getattr

__getattr__ = make_getattr(__name__)
