import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorLineFromTraceback } from './errorLine';

const CANDIDATES = [
  process.env.NUCLEI_PYTHON,
  path.resolve(__dirname, '../../.venv-nuclei/bin/python'),
  path.resolve(__dirname, '../../../../.venv-nuclei/bin/python'),
  path.resolve(__dirname, '../../.venv/bin/python'),
].filter((p): p is string => Boolean(p));
const PYTHON = CANDIDATES.find((p) => existsSync(p)) ?? CANDIDATES[0];
const RUNTIME_DIR = path.resolve(__dirname, '../platform/pyodide');

/** Runs the real kernel_runtime producer and returns the error text it would send. */
function produce(code: string, filename: string): string {
  const script = [
    'import sys, json',
    `sys.path.insert(0, ${JSON.stringify(RUNTIME_DIR)})`,
    'import kernel_runtime as k',
    'ns, out, err = k._run_user_code(sys.argv[1], filename=sys.argv[2])',
    'print(json.dumps(err))',
  ].join('\n');
  return JSON.parse(execFileSync(PYTHON, ['-I', '-c', script, code, filename], { encoding: 'utf8' }).trim()) as string;
}

describe.skipIf(!existsSync(PYTHON))('kernel_runtime traceback through errorLineFromTraceback', () => {
  it.each(['untitled.py', 'bell.py'])('NameError line survives under %s', (name) => {
    expect(errorLineFromTraceback(produce('x = 1\nprnt("hi")', name))).toBe(2);
  });

  it('SyntaxError line survives', () => {
    expect(errorLineFromTraceback(produce('x = 1\ny = (', 'untitled.py'))).toBe(2);
  });
});
