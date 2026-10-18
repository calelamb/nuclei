"""Conjecture Engine (PRD 14 addendum section G): machine-checked trainability conjectures.

An LLM proposes falsifiable conjectures about which circuit structures stay
trainable. This package tests each one on *held-out* circuits drawn from a
structured family grammar, using exact Pauli-propagation scaling studies, and
returns ``supported``, ``refuted`` (with the counterexample) or
``inconclusive``. Nothing here ever claims a conjecture is proven.
"""
