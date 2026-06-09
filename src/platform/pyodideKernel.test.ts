// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { PyodideKernel } from './pyodideKernel';

type CapturedMessage = { type: string; [key: string]: unknown };

describe('PyodideKernel — Q# rejection', () => {
  it('rejects qsharp parse before touching Pyodide', async () => {
    const captured: CapturedMessage[] = [];
    const kernel = new PyodideKernel((msg) => captured.push(msg));

    // Deliberately no init(): the language gate must run first.
    await kernel.send({
      type: 'parse',
      code: 'operation Main() : Unit {}',
      language: 'qsharp',
    });

    expect(captured).toHaveLength(2);
    expect(captured[0]).toEqual({ type: 'snapshot', data: null });
    expect(captured[1].type).toBe('error');
    expect(captured[1].code).toBe('unsupported_framework');
    expect(captured[1].phase).toBe('parse');
    expect(String(captured[1].message)).toContain('desktop');
  });

  it('rejects qsharp execute with a null result as well', async () => {
    const captured: CapturedMessage[] = [];
    const kernel = new PyodideKernel((msg) => captured.push(msg));

    await kernel.send({
      type: 'execute',
      code: 'operation Main() : Unit {}',
      shots: 1024,
      language: 'qsharp',
    });

    expect(captured.map((m) => m.type)).toEqual(['snapshot', 'result', 'error']);
    expect(captured[0]).toEqual({ type: 'snapshot', data: null });
    expect(captured[1]).toEqual({ type: 'result', data: null });
    expect(captured[2].code).toBe('unsupported_framework');
    expect(captured[2].phase).toBe('execute');
    expect(String(captured[2].message)).toContain('desktop');
  });
});
