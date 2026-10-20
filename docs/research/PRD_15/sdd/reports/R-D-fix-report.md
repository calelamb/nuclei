# R-D-fix report (branch prd15/r-d-fix, commit d1b262f)

Fix: `full` and `minimal` test venvs, and the CI corpus-minimal job, now pin `qiskit>=1.2,<2` + `qiskit-aer>=0.15,<1`
(requirements.txt allows 2.x). corpus-full and `pytest` already pinned <2. `pytest-minimal-venv` intentionally left
unpinned (tests exactly requirements.txt = Qiskit 2). README, test docstring and make-test-venvs.sh header document each env.

Venvs rebuilt (NUCLEI_TEST_VENV_REBUILD=1): full, minimal (Qiskit 1.4.6); app-env built (Qiskit 2.6.0, no stim).

Commands (V=~/.cache/nuclei-test-venvs):
    NUCLEI_CORPUS_ENV=full $V/full/bin/python -m pytest kernel/tests/test_research_corpus.py -rxXs -p no:cacheprovider -q
    NUCLEI_CORPUS_ENV=min  $V/minimal/bin/python -m pytest ... (same)
    NUCLEI_CORPUS_ENV=qk2 NUCLEI_CORPUS_PYTHON=$V/app-env/bin/python $V/app-env/bin/python -m pytest ... (same)

Results:
    full: 58 passed, 2 skipped, 30 xfailed in 126.81s
    min:  58 passed, 2 skipped, 30 xfailed in 125.90s
    qk2:  58 passed, 2 skipped, 30 xfailed in 134.52s
Skips: release gate (NUCLEI_CORPUS_RELEASE=1) and the Xvfb display-hang test (xvfb not installed locally). No XPASS/failures.
