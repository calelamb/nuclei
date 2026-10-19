"""Repo-wide collection guard for the kernel test suite.

macOS Finder (and some sync tools) drop duplicate copies named
"<name> 2.py" next to the originals. Those stale snapshots assert
*old* behavior, so collecting them makes the suite double-count tests
at best and fail against current code at worst. Ignore them at
collection time; the files themselves are gitignored (`* 2.py`) and
local-only.
"""

collect_ignore_glob = ["* 2.py"]


def pytest_configure(config) -> None:
    # PRD 14 marks multi-second physics and sandbox tests; they still run by default.
    config.addinivalue_line("markers", "slow: takes more than ~10 s on an idle machine")
