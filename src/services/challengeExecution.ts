import type { TestCase, TestCaseResult } from '../types/challenge';
import type { Framework, KernelResponse, SimulationResult } from '../types/quantum';
import { validateTestCase } from './challengeValidation';
import { createKernelSession, type KernelSession, type PlatformKind } from './kernelSession';

const TEST_TIMEOUT_MS = 35_000;

export function buildTestCode(userCode: string, params: Record<string, unknown>, framework: Framework): string {
  const lines: string[] = [`# === Test parameters (${framework}) ===`];

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key} = ${String(value)}`);
    } else if (value === null) {
      lines.push(`${key} = None`);
    } else {
      lines.push('import json');
      lines.push(`${key} = json.loads(${JSON.stringify(JSON.stringify(value))})`);
    }
  }

  lines.push('');
  lines.push('# === Your code ===');
  lines.push(userCode);

  return lines.join('\n');
}

function buildFailedResult(testCase: TestCase, message: string): TestCaseResult {
  return {
    testCaseId: testCase.id,
    passed: false,
    score: 0,
    message,
    executionTimeMs: 0,
  };
}

function emitFailureResults(
  testCases: ReadonlyArray<TestCase>,
  message: string,
  onResult: (result: TestCaseResult, index: number) => void,
): TestCaseResult[] {
  const results = testCases.map((testCase) => buildFailedResult(testCase, message));
  results.forEach((result, index) => onResult(result, index));
  return results;
}

function createExecutionDriver(session: KernelSession) {
  let pending:
    | {
        resolve: (result: SimulationResult) => void;
        reject: (error: Error) => void;
        timeoutId: ReturnType<typeof setTimeout>;
      }
    | null = null;

  const handleMessage = (message: KernelResponse) => {
    if (!pending) return;

    if (message.type === 'result' && message.data) {
      clearTimeout(pending.timeoutId);
      pending.resolve(message.data);
      pending = null;
      return;
    }

    if (message.type === 'error' && (message.phase === 'execute' || message.phase === 'python')) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(message.message));
      pending = null;
    }
  };

  const execute = (code: string, shots: number) => {
    if (pending) {
      throw new Error('A challenge test is already running');
    }

    return new Promise<SimulationResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!pending) return;
        pending.reject(new Error(`Execution timed out after ${TEST_TIMEOUT_MS / 1000} seconds`));
        pending = null;
      }, TEST_TIMEOUT_MS);

      pending = { resolve, reject, timeoutId };

      let sendResult: void | Promise<void>;
      try {
        sendResult = session.send({ type: 'execute', code, shots });
      } catch (error) {
        clearTimeout(timeoutId);
        pending = null;
        reject(error instanceof Error ? error : new Error('Failed to send challenge to kernel'));
        return;
      }

      Promise.resolve(sendResult).catch((error) => {
        clearTimeout(timeoutId);
        pending = null;
        reject(error instanceof Error ? error : new Error('Failed to send challenge to kernel'));
      });
    });
  };

  const cancel = () => {
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    pending.reject(new Error('Execution canceled'));
    pending = null;
  };

  return { handleMessage, execute, cancel };
}

export async function runTestCases(
  userCode: string,
  testCases: ReadonlyArray<TestCase>,
  framework: Framework,
  platform: PlatformKind,
  shots: number,
  onStart: (index: number) => void,
  onResult: (result: TestCaseResult, index: number) => void,
  onError: (error: string) => void,
): Promise<TestCaseResult[]> {
  if (platform === 'web' && framework !== 'cirq') {
    const message = `The browser challenge runner currently supports Cirq only. Use the desktop app for ${framework}.`;
    onError(message);
    return emitFailureResults(testCases, message, onResult);
  }

  let driver:
    | ReturnType<typeof createExecutionDriver>
    | null = null;

  let session: KernelSession;
  try {
    session = await createKernelSession(platform, (message) => {
      driver?.handleMessage(message);
    });
    driver = createExecutionDriver(session);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Kernel connection failed';
    onError(message);
    return emitFailureResults(testCases, `Connection error: ${message}`, onResult);
  }

  const results: TestCaseResult[] = [];

  try {
    for (let index = 0; index < testCases.length; index++) {
      const testCase = testCases[index];
      const wrappedCode = buildTestCode(userCode, testCase.params, framework);
      const startTime = performance.now();

      onStart(index);

      try {
        const simResult = await driver.execute(wrappedCode, shots);
        const elapsed = performance.now() - startTime;
        const testResult = validateTestCase(testCase, simResult, elapsed);
        results.push(testResult);
        onResult(testResult, index);
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
        onResult(failedResult, index);
      }
    }
  } finally {
    driver.cancel();
    session.close();
  }

  return results;
}
