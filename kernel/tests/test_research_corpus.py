"""Research-program corpus golden (gate G0), driven through a real kernel.

Every ``research_corpus/<unit>/expected.yaml`` is a unit of programs with the
statuses the kernel *should* produce in each env (``min``, ``qk2``, ``full``);
known failures are ``xfail(strict=True)`` tagged with their audit id, so fixing
one flips the build until its entry is updated. See ``research_corpus/loader.py``.

Run (the corpus CI jobs and the wave gate do exactly this)::

    NUCLEI_CORPUS_ENV=full pytest kernel/tests/test_research_corpus.py
    NUCLEI_CORPUS_ENV=qk2 NUCLEI_CORPUS_PYTHON=/path/to/app-env/bin/python ...

Without ``NUCLEI_CORPUS_ENV`` only the structural tests below run (no kernel).
"""

from __future__ import annotations

import os
import subprocess
from collections.abc import Iterator

import pytest

from kernel.tests.research_corpus._support import ENV_VARIABLE, SKIP_REASON, corpus_env, require_yaml

require_yaml()

from kernel.tests.research_corpus import loader, runner  # noqa: E402

ENV = corpus_env()
SCOUT_PROGRAMS = 78


class CorpusMismatch(AssertionError):
    """The kernel did not do what the golden says (an expected failure for xfail cases)."""


class CorpusDrift(Exception):
    """A known-bad program failed in a way the xfail ledger does not describe."""


# -- structure (no kernel) --------------------------------------------------------


def test_corpus_is_well_formed() -> None:
    assert loader.validate() == []


def test_units_are_found_by_glob() -> None:
    names = {unit.name for unit in loader.discover_units()}
    assert {"scout", "gates"} <= names


def test_scout_corpus_has_all_78_programs() -> None:
    scout = [c for c in loader.load_cases("full") if c.unit == "scout"]
    assert len(scout) == SCOUT_PROGRAMS
    assert {c.language for c in scout} == {"python", "qsharp", "stim"}


@pytest.mark.parametrize("env", loader.ENVS)
def test_every_env_resolves_every_program(env: str) -> None:
    cases = loader.load_cases(env)
    assert len({c.id for c in cases}) == len(cases)
    assert all(c.parse or c.execute for c in cases)


def test_xfail_ledger_names_only_audit_ids() -> None:
    ledger = loader.xfail_ledger()
    assert all(loader.RID_PATTERN.match(rid) for rid in ledger)


@pytest.mark.skipif(os.environ.get("NUCLEI_CORPUS_RELEASE") != "1", reason="release gate: NUCLEI_CORPUS_RELEASE=1")
def test_xfail_ledger_is_empty_at_release() -> None:
    assert loader.xfail_ledger() == {}


# -- the corpus, program by program ---------------------------------------------------


def _params() -> list:
    if ENV is None:
        return [pytest.param(None, id="not-requested", marks=pytest.mark.skip(reason=SKIP_REASON))]
    params = []
    for case in loader.load_cases(ENV):
        marks = [pytest.mark.slow] if case.timeout >= 15 or case.options.get("queued_parses") else []
        if case.xfail is not None:
            marks.append(
                pytest.mark.xfail(
                    strict=True,
                    raises=CorpusMismatch,
                    reason=f"{case.xfail.label}: {case.xfail.reason}",
                )
            )
        params.append(pytest.param(case, id=f"{case.unit}:{case.id}", marks=marks))
    return params


@pytest.fixture(scope="session")
def kernel_pool() -> Iterator[runner.KernelPool]:
    pool = runner.KernelPool()
    if ENV is not None:
        found = runner.env_problems(ENV, runner.probe_env(pool.python))
        if found:
            pytest.fail(f"{pool.python} is not a '{ENV}' interpreter: " + "; ".join(found), pytrace=False)
    try:
        yield pool
    finally:
        pool.close()


@pytest.fixture(scope="session")
def xvfb() -> Iterator[runner.XvfbServer]:
    server = runner.XvfbServer()
    try:
        yield server
    finally:
        server.stop()


def _display_for(case: loader.Case, pool: runner.KernelPool, xvfb: runner.XvfbServer) -> str | None:
    """A virtual display for the cases that need one; skip where it cannot be reproduced."""
    if not case.needs_display:
        return None
    display = xvfb.display or xvfb.start()
    if display is None:
        pytest.skip("Xvfb is not installed; cannot reproduce a display-bound hang (apt install xvfb)")
    if case.needs_interactive_backend and not _gui_backend(pool.python, display):
        pytest.skip("Matplotlib would pick a non-interactive backend here; plt.show() cannot hang")
    return display


def _gui_backend(python: str, display: str) -> bool:
    env = {k: v for k, v in os.environ.items() if k != "MPLBACKEND"} | {"DISPLAY": display}
    done = subprocess.run(
        [python, "-c", "import matplotlib; print(matplotlib.get_backend())"],
        capture_output=True, text=True, env=env, timeout=60,
    )
    return done.returncode == 0 and done.stdout.strip().lower() not in ("agg", "pdf", "svg", "ps", "cairo", "template")


@pytest.mark.parametrize("case", _params())
def test_corpus_program(case: loader.Case, kernel_pool: runner.KernelPool, xvfb: runner.XvfbServer) -> None:
    display = _display_for(case, kernel_pool, xvfb)
    if case.needs_memory_limit and not kernel_pool.memory_limited:
        pytest.skip("cannot cap the kernel's memory here (needs Linux prlimit); refusing to run an allocation gate")
    observed = runner.run_pooled(kernel_pool, case, display)
    problems = runner.compare(case, observed)
    if problems and case.xfail is not None and (changed := runner.drift(case, observed)):
        raise CorpusDrift(f"{case.xfail.label} behaves differently than its ledger entry: " + "; ".join(changed))
    if problems:
        raise CorpusMismatch(f"{case.unit}/{case.id} [{ENV_VARIABLE}={ENV}]: " + "; ".join(problems))
