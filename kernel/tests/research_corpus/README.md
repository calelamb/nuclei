# Research corpus (gate G0)

Programs that real researchers write, run through the **real authenticated
WebSocket kernel** (`kernel/server.py`) with `parse` then `execute`, and compared
with a committed golden. `scout/` is the 78-program audit corpus; `gates/` holds the
resource gates (memory refusal, frame size, `plt.show()`, queued parses).

```bash
scripts/make-test-venvs.sh all                       # full, qk2, minimal, app-env
V=scripts/make-test-venvs.sh
# env full: Qiskit 1.x + qdk + stim
NUCLEI_CORPUS_ENV=full "$($V path full)"    -m pytest kernel/tests/test_research_corpus.py
# env min: Qiskit 1.x, requirements.txt only (no qdk, no stim)
NUCLEI_CORPUS_ENV=min  "$($V path minimal)" -m pytest kernel/tests/test_research_corpus.py
# env qk2: Qiskit >= 2 + qdk, NO stim == what the desktop app installs. Use the app-env
# venv (NOT the CI `qk2` venv, which has stim), with NUCLEI_CORPUS_PYTHON pointing at it:
NUCLEI_CORPUS_ENV=qk2 NUCLEI_CORPUS_PYTHON="$($V path app-env)" \
  "$($V path app-env)" -m pytest kernel/tests/test_research_corpus.py
scripts/check-app-env.sh                             # same qk2 run in a fresh venv built from the shell's pip lists
```

`requirements.txt` allows Qiskit 1.x and 2.x, so `full` and `minimal` venvs (and the
corpus-minimal / corpus-full CI jobs) pin `qiskit>=1.2,<2`; the harness refuses to start
an env whose Qiskit major does not match.

Without `NUCLEI_CORPUS_ENV` only the structural tests run (no kernel is started).

## Adding programs (every PRD 15 unit, RED first)

1. Make `kernel/tests/research_corpus/<unit>/programs/<id>.py` (`.qs` Q#, `.stim` Stim).
   A program needing sibling files or a project root is a directory
   `programs/<id>/main.py`; `"$PROJECT"` in `options.request` is replaced by a temp copy.
2. Write `<unit>/expected.yaml` (schema in `loader.py`): what the kernel **should** do per
   phase, for each env (`min`, `qk2`, `full`) using `envs:` overrides where they differ.
3. Until the feature exists, give the entry an `xfail` with the audit id (`R-1`..`R-23`);
   `current` records today's behaviour and is drift-checked. The corpus then stays green
   (strict xfail) and flips red the moment the fix lands, forcing the entry to be updated.
4. To flip a *scout* entry from your own directory, add `<unit>/overrides.yaml`
   (`<program id>: {xfail: null}`); you never edit another unit's files.

Ids are global across units: prefix yours (`ra-...`). Do not weaken a golden to make a
run pass; if a status is wrong for an env, say so under `envs:` with a `note`.

## Safety

The harness caps the kernel at 8 GiB of address space (Linux `prlimit`; gates that
allocate are skipped without it), isolates `NUCLEI_RUNTIME_DIR`, drops `DISPLAY`, and kills the
kernel's whole process group after each program that breaks it.
