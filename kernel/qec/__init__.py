"""QEC Studio kernel support (PRD 10).

Phase A: Detector Error Model extraction (`dem.py`) and built-in circuit
generation (`generate.py`) for Stim stabilizer circuits. The campaign
engine (`campaign.py`, Phase B) builds on these.

Everything in this package treats `stim` as an optional dependency: modules
import it lazily inside functions so the kernel stays importable — and
degrades to `missing_dependency` errors — when Stim isn't installed.
"""
