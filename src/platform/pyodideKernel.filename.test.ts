// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { PyodideKernel } from './pyodideKernel';
import { PyodideRuntimeClient, type WorkerLike } from './pyodide/pyodideClient';
import type { WorkerRequest, WorkerResponse } from './pyodide/workerProtocol';
import { displayFilename, setUserFilenameSource } from './pyodide/userFilename';

afterEach(() => setUserFilenameSource(null));

function makeKernel() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const runtime = new PyodideRuntimeClient(() => {
    const worker: WorkerLike & { onmessage: ((e: { data: WorkerResponse }) => void) | null } = {
      onmessage: null,
      onerror: null,
      terminate() {},
      postMessage(req: WorkerRequest) {
        const reply = (r: WorkerResponse) => worker.onmessage?.({ data: r });
        if (req.type === 'init') { reply({ id: req.id, type: 'result', value: 'ready' }); return; }
        calls.push({ fn: req.fn, args: req.args });
        reply({ id: req.id, type: 'result', value: JSON.stringify({ snapshot: null, result: null, output: '', error: null }) });
      },
    };
    return worker;
  });
  return { kernel: new PyodideKernel(() => {}, runtime), calls };
}

describe('displayFilename', () => {
  it('uses the last path segment and drops the memory:// project id', () => {
    expect(displayFilename('/Users/a/proj/circuits/bell.py')).toBe('bell.py');
    expect(displayFilename('memory://proj-1/untitled-2.py')).toBe('untitled-2.py');
    expect(displayFilename('C:\\work\\bell.py')).toBe('bell.py');
    expect(displayFilename(null)).toBe('untitled.py');
  });
});

describe('PyodideKernel passes the running tab name to Python (research-r-15)', () => {
  it('sends the active tab for execute, parse and run_python, untitled.py when none', async () => {
    const { kernel, calls } = makeKernel();
    await kernel.init();
    setUserFilenameSource(() => '/p/bell.py');
    await kernel.send({ type: 'execute', code: 'x', shots: 8 });
    await kernel.send({ type: 'parse', code: 'x' });
    await kernel.send({ type: 'run_python', code: 'x' });
    setUserFilenameSource(null);
    await kernel.send({ type: 'run_python', code: 'y' });
    expect(calls.map((c) => c.args.at(-1))).toEqual(['bell.py', 'bell.py', 'bell.py', 'untitled.py']);
  });
});
