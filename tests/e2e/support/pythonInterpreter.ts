import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Modules the real QEC Data Engine needs: websockets (kernel/requirements.txt), the QEC data extras, and stim (stim-results adapter). */
const ENGINE_MODULES = ['websockets', 'duckdb', 'pyarrow', 'jsonschema', 'stim'] as const;
const PROBE_TIMEOUT_MS = 15_000;

export type EnginePython = Readonly<{ python: string }> | Readonly<{ skipReason: string }>;

export interface ResolveOptions {
  readonly repositoryRoot: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Last-resort interpreter when the repo has no `.venv` (CI installs the deps into the system python). */
  readonly fallbackPython?: string;
}

export function venvPython(repositoryRoot: string, platform: string = process.platform): string {
  return platform === 'win32'
    ? join(repositoryRoot, '.venv', 'Scripts', 'python.exe')
    : join(repositoryRoot, '.venv', 'bin', 'python');
}

/** Returns '' when `python` can import every engine module, else a one-line description of what is missing. */
function probeEngineModules(python: string): string {
  const code = `import ${ENGINE_MODULES.join(', ')}`;
  const probe = spawnSync(python, ['-c', code], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  if (probe.error) return `${python} could not be started (${probe.error.message})`;
  if (probe.status === 0) return '';
  const lastLine = (probe.stderr ?? '').trim().split('\n').pop() ?? '';
  return `${python} cannot import the engine dependencies (${lastLine || `exit ${probe.status}`})`;
}

/**
 * Picks the interpreter for the real QEC Data Engine. An explicit `NUCLEI_E2E_PYTHON` is trusted;
 * otherwise the repo `.venv` (then a capable system python) is used, and when none can import the
 * engine's dependencies the caller gets a skip reason instead of a confusing "exited before readiness".
 */
export function resolveEnginePython(options: ResolveOptions): EnginePython {
  const explicit = options.env.NUCLEI_E2E_PYTHON;
  if (explicit) return { python: explicit };

  const venv = venvPython(options.repositoryRoot);
  const candidate = existsSync(venv)
    ? venv
    : options.fallbackPython ?? (process.platform === 'win32' ? 'python' : 'python3');
  const problem = probeEngineModules(candidate);
  if (problem === '') return { python: candidate };
  return {
    skipReason:
      `Real QEC Data Engine needs ${ENGINE_MODULES.join(', ')}: ${problem}. ` +
      'Install them into the repo .venv (pip install -r kernel/requirements.txt pyarrow duckdb jsonschema stim) ' +
      'or point NUCLEI_E2E_PYTHON at a capable interpreter.',
  };
}
