"""Shared pieces for the research-corpus tests."""

from __future__ import annotations

import os
from typing import Any

import pytest

ENV_VARIABLE = "NUCLEI_CORPUS_ENV"
SKIP_REASON = (
    f"set {ENV_VARIABLE}=min|qk2|full to run the research corpus against a real kernel "
    "(the corpus CI jobs do; see scripts/make-test-venvs.sh)"
)


def corpus_env() -> str | None:
    """The env the corpus is being run for, or ``None`` when it is not requested."""
    return os.environ.get(ENV_VARIABLE) or None


def require_yaml() -> Any:
    """PyYAML for the corpus tests: skip without it, unless a corpus run was requested.

    PyYAML is a test dependency, not a kernel one, and the repo's dev ``.venv`` may
    not have it. A corpus CI job must never go green by skipping, so when the env
    variable is set a missing PyYAML is an error.
    """
    try:
        import yaml
    except ImportError:
        if corpus_env():
            raise
        pytest.skip("PyYAML is not installed (pip install pyyaml)", allow_module_level=True)
    return yaml
