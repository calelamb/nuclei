#!/usr/bin/env bash
# check-app-env.sh -- release-time "owner-env" check (PRD 15 gate G4).
#
# Builds a venv the way the desktop shell does -- system Python's `-m venv`,
# KERNEL_CORE_DEPS, then the catalog entries' pip lists, unpinned -- by reading
# them out of src-tauri/src/commands/frameworks.rs (so a change to the shell's
# lists is picked up automatically), and runs the research-corpus golden (corpus
# env `qk2`) against a kernel directory: by default the freshly built bundle's
# `kernel/`. Exits non-zero on any unexpected status.
#
# This is what would have caught the Qiskit 2.x drift (R-14) and the missing
# ruff (R-16).
#
#   scripts/check-app-env.sh [--kernel-dir DIR] [--catalog ids] [--python PY]
#                            [--release] [--keep] [-- pytest args...]
#
#   --kernel-dir DIR  kernel directory to test (default: $NUCLEI_BUNDLE_KERNEL_DIR,
#                     else src-tauri/target/release/kernel, else the repo's kernel/
#                     with a warning that it is not a bundle)
#   --catalog IDS     comma list of catalog ids to install (default qiskit,cirq,qsharp;
#                     "research" adds the whole research group)
#   --python PY       the "system" Python used to create the venv (default python3)
#   --release         also require the xfail ledger to be empty (master 5.3)
#   --keep            keep the work directory (it is printed) instead of deleting it
#
# Needs network access (pip). It never touches ~/.nuclei or an installed Nuclei.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3}"
KERNEL_DIR="${NUCLEI_BUNDLE_KERNEL_DIR:-}"
CATALOG="${NUCLEI_APP_ENV_CATALOG:-qiskit,cirq,qsharp}"
RELEASE=0
KEEP=0
PYTEST_ARGS=()

die() { echo "check-app-env: $*" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --kernel-dir) KERNEL_DIR="${2:?--kernel-dir needs a path}"; shift 2 ;;
    --catalog) CATALOG="${2:?--catalog needs ids}"; shift 2 ;;
    --python) PYTHON="${2:?--python needs a command}"; shift 2 ;;
    --release) RELEASE=1; shift ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift; PYTEST_ARGS=("$@"); break ;;
    *) die "unknown argument '$1' (try --help)" ;;
  esac
done

if [[ -z "$KERNEL_DIR" ]]; then
  if [[ -f "$REPO/src-tauri/target/release/kernel/server.py" ]]; then
    KERNEL_DIR="$REPO/src-tauri/target/release/kernel"
  else
    KERNEL_DIR="$REPO/kernel"
    echo "check-app-env: WARNING no built bundle found; testing the repo's kernel/ (pass --kernel-dir for a bundle)" >&2
  fi
fi
[[ -f "$KERNEL_DIR/server.py" ]] || die "no server.py under $KERNEL_DIR"
KERNEL_DIR="$(cd "$KERNEL_DIR" && pwd)"
command -v "$PYTHON" >/dev/null 2>&1 || die "$PYTHON not found"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/nuclei-app-env.XXXXXX")"
cleanup() {
  if [[ "$KEEP" == 1 ]]; then echo "check-app-env: work dir kept at $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

echo "== app env: $("$PYTHON" --version) -> $WORK/app"
"$PYTHON" -m venv "$WORK/app"
mapfile -t REQS < <(NUCLEI_APP_ENV_CATALOG="$CATALOG" "$REPO/scripts/make-test-venvs.sh" app-env-requirements)
[[ ${#REQS[@]} -gt 0 ]] || die "the shell's pip lists came back empty"
echo "== the shell installs: ${REQS[*]}"
"$WORK/app/bin/python" -m pip install --disable-pip-version-check --quiet --upgrade pip
"$WORK/app/bin/python" -m pip install --disable-pip-version-check --quiet "${REQS[@]}"

echo "== test runner (kept apart so the app env stays exactly what the shell builds)"
"$PYTHON" -m venv "$WORK/runner"
"$WORK/runner/bin/python" -m pip install --disable-pip-version-check --quiet pytest pyyaml "websockets>=13,<17"

echo "== corpus (env qk2) against $KERNEL_DIR"
cd "$REPO"
export NUCLEI_CORPUS_ENV=qk2
export NUCLEI_CORPUS_PYTHON="$WORK/app/bin/python"
export NUCLEI_CORPUS_KERNEL_DIR="$KERNEL_DIR"
[[ "$RELEASE" == 1 ]] && export NUCLEI_CORPUS_RELEASE=1
"$WORK/runner/bin/python" -m pytest kernel/tests/test_research_corpus.py -p no:cacheprovider -rxXs "${PYTEST_ARGS[@]}"
