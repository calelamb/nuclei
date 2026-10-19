"""program_key normalization and the evaluation LRU."""

from __future__ import annotations

from kernel.discovery.cache import EvaluationCache, cache_key, program_key

BASE = "def build(d, r):\n    x = 1\n    return x\n"


def test_comments_and_whitespace_share_a_program_key():
    edited = "# a new comment\ndef build(d,  r):\n\n    x   =  1  # trailing\n    return x\n\n\n"
    assert program_key(edited) == program_key(BASE)
    assert len(program_key(BASE)) == 64


def test_semantic_edits_change_the_key():
    assert program_key(BASE.replace("x = 1", "x = 2")) != program_key(BASE)
    assert program_key(BASE.replace("x = 1", "y = 1").replace("return x", "return y")) != program_key(BASE)


def test_unparseable_programs_are_keyed_distinctly_and_stably():
    bad = "def build(:\n"
    assert program_key(bad) == program_key(bad)
    assert program_key(bad) != program_key(bad + " ")


def test_lru_hit_miss_and_isolation():
    cache = EvaluationCache(capacity=2)
    k1, k2, k3 = (cache_key(f"x = {i}", "fp", 1, "full") for i in (1, 2, 3))
    assert cache.get(k1) is None
    record = {"status": "scored", "metrics": {"a": [1]}}
    cache.put(k1, record)
    record["metrics"]["a"].append(2)  # mutating the original must not leak in
    hit = cache.get(k1)
    assert hit == {"status": "scored", "metrics": {"a": [1]}}
    hit["status"] = "mutated"
    assert cache.get(k1)["status"] == "scored"
    cache.put(k2, {"n": 2})
    cache.get(k1)  # k1 is now most recent
    cache.put(k3, {"n": 3})
    assert cache.get(k2) is None and cache.get(k1) is not None and len(cache) == 2


def test_key_dimensions():
    base = cache_key(BASE, "fp", 1, "full")
    assert base != cache_key(BASE, "fp2", 1, "full")
    assert base != cache_key(BASE, "fp", 2, "full")
    assert base != cache_key(BASE, "fp", 1, "screen")
    assert base == cache_key("# c\n" + BASE, "fp", 1, "full")
