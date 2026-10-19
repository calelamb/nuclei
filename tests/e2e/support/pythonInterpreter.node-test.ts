// Run with: node --test tests/e2e/support/pythonInterpreter.node-test.ts
// (Node >= 22.18 strips types natively; kept out of vitest, whose include is src/**.)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveEnginePython, venvPython } from './pythonInterpreter.ts';

const FAKE_OK = '#!/bin/sh\nexit 0\n';
const FAKE_NO_DEPS = '#!/bin/sh\necho "ModuleNotFoundError: No module named websockets" >&2\nexit 1\n';

function repoWithVenv(script: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'nuclei-pyresolve-'));
  if (script !== null) {
    const py = venvPython(root);
    mkdirSync(join(py, '..'), { recursive: true });
    writeFileSync(py, script);
    chmodSync(py, 0o755);
  }
  return root;
}

test('NUCLEI_E2E_PYTHON wins and is trusted without probing', () => {
  const root = repoWithVenv(FAKE_OK);
  const result = resolveEnginePython({ repositoryRoot: root, env: { NUCLEI_E2E_PYTHON: '/opt/custom/python' } });
  assert.deepEqual(result, { python: '/opt/custom/python' });
  rmSync(root, { recursive: true, force: true });
});

test('defaults to the repo .venv interpreter when it has the engine dependencies', () => {
  const root = repoWithVenv(FAKE_OK);
  const result = resolveEnginePython({ repositoryRoot: root, env: {} });
  assert.deepEqual(result, { python: venvPython(root) });
  rmSync(root, { recursive: true, force: true });
});

test('a .venv missing the engine dependencies skips with an explicit reason', () => {
  const root = repoWithVenv(FAKE_NO_DEPS);
  const result = resolveEnginePython({ repositoryRoot: root, env: {}, fallbackPython: join(root, 'absent-python') });
  assert.ok('skipReason' in result);
  assert.match(result.skipReason, /websockets/);
  assert.match(result.skipReason, /NUCLEI_E2E_PYTHON/);
  rmSync(root, { recursive: true, force: true });
});

test('with no .venv it falls back to a system python only when that python is capable', () => {
  const root = repoWithVenv(null);
  const sys = join(root, 'sys-python');
  writeFileSync(sys, FAKE_OK);
  chmodSync(sys, 0o755);
  assert.deepEqual(resolveEnginePython({ repositoryRoot: root, env: {}, fallbackPython: sys }), { python: sys });
  writeFileSync(sys, FAKE_NO_DEPS);
  const skipped = resolveEnginePython({ repositoryRoot: root, env: {}, fallbackPython: sys });
  assert.ok('skipReason' in skipped);
  rmSync(root, { recursive: true, force: true });
});
