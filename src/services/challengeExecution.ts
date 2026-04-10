import type { TestCase, TestCaseResult } from '../types/challenge';
import type { Framework, SimulationResult, KernelResponse } from '../types/quantum';
import { validateTestCase } from './challengeValidation';
import { KERNEL_WS_URL } from '../config/kernel';

export function buildTestCode(userCode: string, params: Record<string, unknown>): string {
  const lines: string[] = ['# === Test parameters ==='];

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key} = ${String(value)}`);
    } else if (value === null) {
      lines.push(`${key} = None`);
    } else {
      lines.push(`import json`);
      lines.push(`${key} = json.loads(${JSON.stringify(JSON.stringify(value))})`);
    }
  }

  lines.push('');
  lines.push('# === Your code ===');
  lines.push(userCode);

  return lines.join('\n');
}

function executeOnKernel(
  ws: WebSocket,
  code: string,
  shots: number,
): Promise<SimulationResult> {
  return new Promise((resolve, reject) => {
    const handler = (ev: MessageEvent) => {
      try {
        const msg: KernelResponse = JSON.parse(ev.data as string);
        if (msg.type === 'result') {
          ws.removeEventListener('message', handler);
          resolve(msg.data);
        }
        if (msg.type === 'error') {
          ws.removeEventListener('message', handler);
          reject(new Error(msg.message));
        }
        // Ignore 'snapshot' and 'output' messages during test execution
      } catch {
        ws.removeEventListener('message', handler);
        reject(new Error('Failed to parse kernel response'));
      }
    };

    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ type: 'execute', code, shots }));
  });
}

function connectKernel(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(KERNEL_WS_URL);

    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', () => {
      reject(new Error(`Failed to connect to kernel at ${KERNEL_WS_URL}`));
    }, { once: true });
  });
}

export async function runTestCases(
  userCode: string,
  testCases: ReadonlyArray<TestCase>,
  _framework: Framework,
  shots: number,
  onResult: (result: TestCaseResult, index: number) => void,
  onError: (error: string) => void,
): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  let ws: WebSocket;
  try {
    ws = await connectKernel();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Kernel connection failed';
    onError(message);
    return testCases.map((tc) => ({
      testCaseId: tc.id,
      passed: false,
      score: 0,
      message: `Connection error: ${message}`,
      executionTimeMs: 0,
    }));
  }

  try {
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const wrappedCode = buildTestCode(userCode, testCase.params);
      const startTime = performance.now();

      try {
        const simResult = await executeOnKernel(ws, wrappedCode, shots);
        const elapsed = performance.now() - startTime;
        const testResult = validateTestCase(testCase, simResult, elapsed);
        results.push(testResult);
        onResult(testResult, i);
      } catch (err: unknown) {
        const elapsed = performance.now() - startTime;
        const message = err instanceof Error ? err.message : 'Unknown execution error';
        const failedResult: TestCaseResult = {
          testCaseId: testCase.id,
          passed: false,
          score: 0,
          message: `Runtime error: ${message}`,
          executionTimeMs: elapsed,
        };
        results.push(failedResult);
        onResult(failedResult, i);
      }
    }
  } finally {
    ws.close();
  }

  return results;
}
