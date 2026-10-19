#!/usr/bin/env bash
# make-test-venvs.sh -- build the kernel test environments with `uv`.
#
#   scripts/make-test-venvs.sh [full|qk2|minimal|app-env|all]
#   scripts/make-test-venvs.sh path <name>      # print a venv's python
#   scripts/make-test-venvs.sh app-env-spec     # print the shell's pip lists
#
# Venvs (default root: $NUCLEI_TEST_VENV_DIR, else ~/.cache/nuclei-test-venvs):
#
#   full      Python 3.12, Qiskit 1.x     kernel/requirements.txt with Qiskit pinned
#                                         <2 (requirements.txt itself allows 2.x) +
#                                         the whole CI optional stack (qdk, stim, ...)
#                                         == the `pytest` and `corpus-full` jobs
#                                         == corpus env `full`
#   qk2       Python 3.13, Qiskit 2.x     same optional stack on Qiskit >=2,<3
#                                         == the `pytest-qiskit2` job
#   minimal   Python 3.12, Qiskit 1.x     kernel/requirements.txt ONLY, Qiskit pinned
#                                         <2 == `corpus-minimal` (corpus env `min`).
#                                         NOTE: `pytest-minimal-venv` installs the bare
#                                         requirements.txt (Qiskit 2.x); this venv does not.
#   app-env   Python 3.13                 exactly what the desktop shell pip-installs:
#                                         KERNEL_CORE_DEPS + the unpinned catalog
#                                         entries parsed out of frameworks.rs
#                                         == `corpus-app-env` (corpus env `qk2`)
#
# Running the research corpus locally (kernel/tests/research_corpus/README.md):
#   NUCLEI_CORPUS_ENV=full "$(scripts/make-test-venvs.sh path full)"    -m pytest kernel/tests/test_research_corpus.py
#   NUCLEI_CORPUS_ENV=min  "$(scripts/make-test-venvs.sh path minimal)" -m pytest kernel/tests/test_research_corpus.py
#   NUCLEI_CORPUS_ENV=qk2 NUCLEI_CORPUS_PYTHON="$(scripts/make-test-venvs.sh path app-env)" \
#     "$(scripts/make-test-venvs.sh path app-env)" -m pytest kernel/tests/test_research_corpus.py
# qk2 MUST use the app-env venv (Qiskit >=2, qdk, NO stim); the CI `qk2` venv has stim and is
# for the full pytest suite only. min/full need Qiskit 1.x, hence the pins below.
#
# Every venv also gets the test runners (pytest, pytest-asyncio, pytest-cov,
# pyyaml). Existing venvs are reused; set NUCLEI_TEST_VENV_REBUILD=1 to rebuild.
#
# The app-env catalog selection defaults to the simulation frameworks
# (qiskit, cirq, qsharp). Override with NUCLEI_APP_ENV_CATALOG="qiskit,cirq,stim"
# or "research" (the whole research group) -- ids are the `id:` fields of
# CATALOG in src-tauri/src/commands/frameworks.rs.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${NUCLEI_TEST_VENV_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/nuclei-test-venvs}"
FRAMEWORKS_RS="$REPO/src-tauri/src/commands/frameworks.rs"
UV="${UV:-uv}"

TEST_RUNNERS=(pytest pytest-asyncio pytest-cov pyyaml)

# kernel/requirements.txt allows Qiskit 1.x and 2.x; corpus envs `min` and `full` are defined as
# Qiskit 1.x (runner.env_problems), matching the CI `pytest` / corpus-minimal / corpus-full jobs.
QISKIT1_PIN=("qiskit>=1.2,<2" "qiskit-aer>=0.15,<1")

# The CI optional stack (keep in step with .github/workflows/kernel-tests.yml).
OPTIONAL_STACK=(
  "qdk>=1.29,<2"
  "stim>=1.14,<2" "sinter>=1.14,<2" "pymatching>=2.1,<3"
  "pyarrow>=18,<26" "duckdb>=1.2,<2" "jsonschema>=4.23,<5"
)

die() { echo "make-test-venvs: $*" >&2; exit 1; }

need_uv() {
  command -v "$UV" >/dev/null 2>&1 || die "uv not found (install: https://docs.astral.sh/uv/)"
}

venv_python() { echo "$ROOT/$1/bin/python"; }

# create_venv <name> <python-version>; echoes nothing, returns 0 when (re)built
create_venv() {
  local name="$1" version="$2" dir="$ROOT/$1"
  if [[ -x "$dir/bin/python" && "${NUCLEI_TEST_VENV_REBUILD:-0}" != "1" ]]; then
    echo "[$name] reusing $dir"
    return 0
  fi
  rm -rf "$dir"
  mkdir -p "$ROOT"
  echo "[$name] creating $dir (python $version)"
  "$UV" venv --quiet --python "$version" "$dir"
}

pip_install() {
  local name="$1"; shift
  "$UV" pip install --quiet --python "$(venv_python "$name")" "$@"
}

# Parse frameworks.rs: print `core <dep>` lines for KERNEL_CORE_DEPS and
# `catalog <id> <group> <pip_name>` lines for each CATALOG entry.
app_env_spec() {
  [[ -f "$FRAMEWORKS_RS" ]] || die "cannot find $FRAMEWORKS_RS"
  python3 - "$FRAMEWORKS_RS" <<'PY'
import re
import sys

src = open(sys.argv[1], encoding="utf-8").read()

core = re.search(r"const KERNEL_CORE_DEPS:\s*&\[&str\]\s*=\s*&\[(.*?)\];", src, re.S)
if not core:
    sys.exit("KERNEL_CORE_DEPS not found in frameworks.rs")
for dep in re.findall(r'"([^"]+)"', core.group(1)):
    print("core", dep)

catalog = re.search(r"const CATALOG:[^=]*=\s*&\[(.*)\n\];", src, re.S)
if not catalog:
    sys.exit("CATALOG not found in frameworks.rs")
for block in re.findall(r"FrameworkInfo\s*\{(.*?)\n    \},", catalog.group(1), re.S):
    fields = dict(re.findall(r'\b(id|group|pip_name):\s*"([^"]*)"', block))
    if {"id", "group", "pip_name"} <= fields.keys():
        print("catalog", fields["id"], fields["group"], fields["pip_name"])
PY
}

# app_env_requirements -> one requirement per line (core deps + chosen catalog)
app_env_requirements() {
  local selection="${NUCLEI_APP_ENV_CATALOG:-qiskit,cirq,qsharp}"
  app_env_spec | python3 -c '
import sys
selection = [s.strip() for s in sys.argv[1].split(",") if s.strip()]
core, catalog = [], []
for line in sys.stdin:
    kind, _, rest = line.rstrip("\n").partition(" ")
    if kind == "core":
        core.append(rest)
    else:
        ident, group, pip_name = rest.split(" ", 2)
        catalog.append((ident, group, pip_name))
wanted = set()
for token in selection:
    if token in ("research", "core", "provider"):
        wanted.update(i for i, g, _ in catalog if g == token)
    else:
        wanted.add(token)
unknown = wanted - {i for i, _, _ in catalog}
if unknown:
    sys.exit("unknown catalog id(s): " + ", ".join(sorted(unknown)))
for dep in core:
    print(dep)
for ident, _, pip_name in catalog:
    if ident in wanted:
        for part in pip_name.split():   # the shell splits pip_name on whitespace
            print(part)
' "$selection"
}

build_full() {
  create_venv full 3.12
  pip_install full -r "$REPO/kernel/requirements.txt" "${QISKIT1_PIN[@]}" "${OPTIONAL_STACK[@]}" "${TEST_RUNNERS[@]}"
}

build_qk2() {
  create_venv qk2 3.13
  pip_install qk2 "websockets>=13,<17" "numpy>=1.26,<3.0" "ruff>=0.6,<1.0" "keyring>=24" \
    "qiskit>=2,<3" "qiskit-aer>=0.17,<1" "cirq-core>=1.4,<2" \
    "${OPTIONAL_STACK[@]}" "${TEST_RUNNERS[@]}"
}

build_minimal() {
  create_venv minimal 3.12
  pip_install minimal -r "$REPO/kernel/requirements.txt" "${QISKIT1_PIN[@]}" "${TEST_RUNNERS[@]}"
}

build_app_env() {
  create_venv app-env 3.13
  local reqs
  mapfile -t reqs < <(app_env_requirements)
  [[ ${#reqs[@]} -gt 0 ]] || die "empty app-env requirement list"
  echo "[app-env] shell installs: ${reqs[*]}"
  pip_install app-env "${reqs[@]}" "${TEST_RUNNERS[@]}"
}

main() {
  local cmd="${1:-all}"
  case "$cmd" in
    app-env-spec) app_env_spec; return ;;
    app-env-requirements) app_env_requirements; return ;;
    path) [[ -n "${2:-}" ]] || die "usage: path <name>"; venv_python "$2"; return ;;
  esac
  need_uv
  case "$cmd" in
    full) build_full ;;
    qk2) build_qk2 ;;
    minimal) build_minimal ;;
    app-env) build_app_env ;;
    all) build_full; build_qk2; build_minimal; build_app_env ;;
    *) die "unknown command '$cmd' (full|qk2|minimal|app-env|all|path|app-env-spec)" ;;
  esac
  echo "venvs under $ROOT"
}

main "$@"
