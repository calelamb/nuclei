import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

const ENGINE_URL = 'ws://127.0.0.1:9743';
const READY_LINE = 'NUCLEI_QEC_DATA_READY 127.0.0.1:9743';
const START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;
const MAX_DIAGNOSTIC_BYTES = 8_192;

export interface RealQecDataEngine {
  readonly projectRoot: string;
  readonly endpoint: Readonly<{ url: string; token: string }>;
  close(): Promise<void>;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => resolveExit(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolveExit(true);
    });
  });
}

async function terminateAndReap(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (await waitForExit(child, STOP_TIMEOUT_MS)) return;
  child.kill('SIGKILL');
  if (!await waitForExit(child, STOP_TIMEOUT_MS)) {
    throw new Error('Real QEC Data Engine did not exit after forced termination.');
  }
}

function awaitReadiness(child: ChildProcess, diagnostics: () => string): Promise<void> {
  if (!child.stdout) return Promise.reject(new Error('QEC Data Engine stdout is unavailable.'));
  const lines = createInterface({ input: child.stdout });
  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lines.close();
      if (error) rejectReady(error);
      else resolveReady();
    };
    const timeout = setTimeout(() => finish(new Error(
      `Real QEC Data Engine readiness timed out. ${diagnostics()}`.trim(),
    )), START_TIMEOUT_MS);
    lines.on('line', (line) => {
      if (line === READY_LINE) finish();
      else if (line.startsWith('NUCLEI_QEC_DATA_ERROR ')) {
        finish(new Error(`Real QEC Data Engine startup failed: ${line}`));
      }
    });
    child.once('exit', (code, signal) => finish(new Error(
      `Real QEC Data Engine exited before readiness (${code ?? signal}). ${diagnostics()}`.trim(),
    )));
    child.once('error', (error) => finish(error));
  });
}

export async function launchRealQecDataEngine(): Promise<RealQecDataEngine> {
  const fixtureRoot = resolve('tests/e2e/fixtures/qec-project');
  const projectRoot = mkdtempSync(join(tmpdir(), 'nuclei-qec-e2e-'));
  cpSync(fixtureRoot, projectRoot, { recursive: true });
  const token = randomBytes(32).toString('hex');
  const python = process.env.NUCLEI_E2E_PYTHON
    ?? (process.platform === 'win32' ? 'python' : 'python3');
  const repositoryRoot = resolve('.');
  const child = spawn(python, ['tests/e2e/support/qec_data_engine.py'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NUCLEI_QEC_DATA_PROJECT_ROOT: projectRoot,
      NUCLEI_QEC_DATA_TOKEN: token,
      PYTHONPATH: [repositoryRoot, process.env.PYTHONPATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostic = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    diagnostic = `${diagnostic}${chunk.toString('utf8')}`.slice(-MAX_DIAGNOSTIC_BYTES);
  });
  try {
    await awaitReadiness(child, () => diagnostic);
  } catch (error: unknown) {
    await terminateAndReap(child);
    rmSync(projectRoot, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({
    projectRoot,
    endpoint: Object.freeze({ url: ENGINE_URL, token }),
    close: async () => {
      await terminateAndReap(child);
      rmSync(projectRoot, { recursive: true, force: true });
    },
  });
}
