"""Program normalization and the in-kernel evaluation LRU (PRD 14 spec 4.1.5 / 6.6)."""

from __future__ import annotations

import ast
import copy
import hashlib
import threading
from collections import OrderedDict
from typing import Any

from kernel.discovery.constants import EVALUATION_CACHE_SIZE

CacheKey = tuple[str, str, int, str, str]


class ProgramSyntaxError(ValueError):
    """The program does not parse, so it has no normalized form."""


def normalize_program(program: str) -> str:
    """The normalized form the cache key is built from: ``ast.dump`` of the parsed module.

    Comments and whitespace do not survive parsing, so editing them is free.
    Raises :class:`ProgramSyntaxError` when the program does not parse.
    """
    try:
        return "ast:" + ast.dump(ast.parse(program))
    except SyntaxError as exc:
        where = f" (line {exc.lineno})" if exc.lineno else ""
        raise ProgramSyntaxError(f"{exc.msg}{where}") from exc
    except (ValueError, RecursionError, MemoryError) as exc:
        raise ProgramSyntaxError(f"{type(exc).__name__}: {exc}"[:200]) from exc


def program_key(program: str) -> str:
    """SHA-256 of the normalized program (see :func:`normalize_program`).

    A program that does not parse is keyed by its raw text under a distinct
    prefix, so it can never collide with a parseable program.
    """
    try:
        material = normalize_program(program)
    except ProgramSyntaxError:
        material = "raw:" + program
    return hashlib.sha256(material.encode("utf-8", errors="surrogatepass")).hexdigest()


def strict_program_key(program: str) -> str:
    """Like :func:`program_key` but raises :class:`ProgramSyntaxError` instead of keying raw text."""
    material = normalize_program(program)
    return hashlib.sha256(material.encode("utf-8", errors="surrogatepass")).hexdigest()


def cache_key(program: str, fingerprint: str, seed: int, stage: str, entry: str = "build") -> CacheKey:
    return (program_key(program), fingerprint, seed, stage, entry)


class EvaluationCache:
    """Thread-safe LRU of finished evaluations. Stores and returns deep copies."""

    def __init__(self, capacity: int = EVALUATION_CACHE_SIZE):
        self._capacity = capacity
        self._items: OrderedDict[CacheKey, dict[str, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: CacheKey) -> dict[str, Any] | None:
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            self._items.move_to_end(key)
            return copy.deepcopy(item)

    def put(self, key: CacheKey, evaluation: dict[str, Any]) -> None:
        with self._lock:
            self._items[key] = copy.deepcopy(evaluation)
            self._items.move_to_end(key)
            while len(self._items) > self._capacity:
                self._items.popitem(last=False)

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
