import type {
  ChallengeJsonValue,
  QuantumChallenge,
  SubmissionStatus,
  TestCase,
  TestCaseResult,
} from '../types/challenge';
import type {
  CircuitSnapshot,
  Framework,
  KernelResponse,
  SimulationResult,
} from '../types/quantum';
import { validateTestCase, validateValueTestCase } from './challengeValidation';
import { createKernelSession, type KernelSession, type PlatformKind } from './kernelSession';

const TEST_TIMEOUT_MS = 35_000;
const VALUE_RESULT_MARKER = '__NUCLEI_CHALLENGE_VALUE__=';

type FailureVerdict = Extract<
  SubmissionStatus,
  'runtime_error' | 'compile_error' | 'time_limit_exceeded'
>;

interface ChallengeExecutionFailure {
  verdict: FailureVerdict;
  message: string;
}

interface ChallengeExecutionArtifact {
  result: SimulationResult;
  snapshot: CircuitSnapshot | null;
  stdout: string;
}

interface ChallengeValueArtifact {
  value: ChallengeJsonValue;
  stdout: string;
}

class ChallengeKernelError extends Error {
  code?: string;
  phase?: 'parse' | 'execute' | 'python';
  framework?: Framework;

  constructor(message: string, metadata: Partial<ChallengeKernelError> = {}) {
    super(message);
    this.name = 'ChallengeKernelError';
    Object.assign(this, metadata);
  }
}

function serializeParams(params: Record<string, unknown>) {
  return JSON.stringify(JSON.stringify(params));
}

function buildLegacyTestCode(userCode: string, params: Record<string, unknown>, framework: Framework): string {
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

function buildCanonicalTestCode(
  userCode: string,
  challenge: QuantumChallenge,
  params: Record<string, unknown>,
): string {
  const entrypoint = challenge.entrypoint_name ?? 'solve';

  return `# === Your solution ===
${userCode}

# === Challenge harness ===
import json as __nuclei_json

__nuclei_params = __nuclei_json.loads(${serializeParams(params)})
__nuclei_circuit = ${entrypoint}(**__nuclei_params)

from qiskit import QuantumCircuit as __NucleiQuantumCircuit

if not isinstance(__nuclei_circuit, __NucleiQuantumCircuit):
    raise TypeError("${entrypoint}(...) must return a QuantumCircuit")

qc = __nuclei_circuit
`;
}

export function buildValueTestCode(
  userCode: string,
  challenge: QuantumChallenge,
  params: Record<string, unknown>,
): string {
  const entrypoint = challenge.entrypoint_name ?? 'solve';

  return `# === Your solution ===
${userCode}

# === Challenge harness ===
import json as __nuclei_json

__nuclei_params = __nuclei_json.loads(${serializeParams(params)})
__nuclei_value = ${entrypoint}(**__nuclei_params)

try:
    __nuclei_payload = __nuclei_json.dumps(__nuclei_value, sort_keys=True)
except TypeError as __nuclei_error:
    raise TypeError("${entrypoint}(...) must return a JSON-serializable value") from __nuclei_error

print("${VALUE_RESULT_MARKER}" + __nuclei_payload)
`;
}

export function buildTestCode(
  userCode: string,
  challenge: QuantumChallenge,
  params: Record<string, unknown>,
  framework: Framework,
): string {
  if (challenge.contract_kind === 'returns_value') {
    return buildValueTestCode(userCode, challenge, params);
  }

  if (
    framework === 'qiskit'
    && challenge.contract_kind === 'returns_circuit'
    && challenge.entrypoint_name
  ) {
    return buildCanonicalTestCode(userCode, challenge, params);
  }

  return buildLegacyTestCode(userCode, params, framework);
}

function parseValueResult(stdout: string): ChallengeJsonValue {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.trim().startsWith(VALUE_RESULT_MARKER));

  if (!line) {
    throw new ChallengeKernelError(
      `No challenge return marker found. Make sure solve(...) returns a JSON-serializable value.`,
      { phase: 'python', code: 'bad_response' },
    );
  }

  const rawJson = line.trim().slice(VALUE_RESULT_MARKER.length);
  try {
    return JSON.parse(rawJson) as ChallengeJsonValue;
  } catch {
    throw new ChallengeKernelError(
      `Challenge return marker was not valid JSON: ${rawJson}`,
      { phase: 'python', code: 'bad_response' },
    );
  }
}

function buildFailedResult(
  testCase: TestCase,
  message: string,
  verdict: FailureVerdict = 'runtime_error',
): TestCaseResult {
  return {
    testCaseId: testCase.id,
    passed: false,
    score: 0,
    verdict,
    message,
    executionTimeMs: 0,
  };
}

function emitFailureResults(
  testCases: ReadonlyArray<TestCase>,
  message: string,
  onResult: (result: TestCaseResult, index: number) => void,
  verdict: FailureVerdict = 'runtime_error',
): TestCaseResult[] {
  const results = testCases.map((testCase) => buildFailedResult(testCase, message, verdict));
  results.forEach((result, index) => onResult(result, index));
  return results;
}

function createExecutionDriver(session: KernelSession) {
  let pending:
    | {
        kind: 'circuit';
        resolve: (result: ChallengeExecutionArtifact) => void;
        reject: (error: ChallengeKernelError) => void;
        timeoutId: ReturnType<typeof setTimeout>;
        snapshot: CircuitSnapshot | null;
        output: string[];
      }
    | {
        kind: 'value';
        resolve: (result: ChallengeValueArtifact) => void;
        reject: (error: ChallengeKernelError) => void;
        timeoutId: ReturnType<typeof setTimeout>;
        output: string[];
        error: ChallengeKernelError | null;
      }
    | null = null;

  const handleMessage = (message: KernelResponse) => {
    if (!pending) return;

    if (message.type === 'output') {
      pending.output.push(message.text);
      return;
    }

    if (pending.kind === 'circuit' && message.type === 'snapshot') {
      pending.snapshot = message.data;
      return;
    }

    if (pending.kind === 'circuit' && message.type === 'result' && message.data) {
      clearTimeout(pending.timeoutId);
      pending.resolve({
        result: message.data,
        snapshot: pending.snapshot,
        stdout: pending.output.join(''),
      });
      pending = null;
      return;
    }

    if (message.type === 'python_result' && pending.kind === 'value') {
      clearTimeout(pending.timeoutId);
      if (!message.success) {
        pending.reject(pending.error ?? new ChallengeKernelError(
          'Python execution failed',
          { phase: 'python', code: 'execution_error' },
        ));
        pending = null;
        return;
      }

      try {
        pending.resolve({
          value: parseValueResult(pending.output.join('')),
          stdout: pending.output.join(''),
        });
      } catch (error) {
        pending.reject(error instanceof ChallengeKernelError
          ? error
          : new ChallengeKernelError(error instanceof Error ? error.message : 'Failed to parse challenge return value'));
      }
      pending = null;
      return;
    }

    if (message.type === 'error' && (message.phase === 'execute' || message.phase === 'python')) {
      const error = new ChallengeKernelError(message.message, {
        code: message.code,
        phase: message.phase,
        framework: message.framework,
      });

      if (pending.kind === 'value') {
        pending.error = error;
        return;
      }

      clearTimeout(pending.timeoutId);
      pending.reject(error);
      pending = null;
    }
  };

  const execute = (code: string, shots: number) => {
    if (pending) {
      throw new Error('A challenge test is already running');
    }

    return new Promise<ChallengeExecutionArtifact>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!pending) return;
        pending.reject(new ChallengeKernelError(
          `Execution timed out after ${TEST_TIMEOUT_MS / 1000} seconds`,
          { code: 'timeout', phase: 'execute' },
        ));
        pending = null;
      }, TEST_TIMEOUT_MS);

      pending = { kind: 'circuit', resolve, reject, timeoutId, snapshot: null, output: [] };

      let sendResult: void | Promise<void>;
      try {
        sendResult = session.send({ type: 'execute', code, shots });
      } catch (error) {
        clearTimeout(timeoutId);
        pending = null;
        reject(error instanceof ChallengeKernelError
          ? error
          : new ChallengeKernelError(
            error instanceof Error ? error.message : 'Failed to send challenge to kernel',
          ));
        return;
      }

      Promise.resolve(sendResult).catch((error) => {
        clearTimeout(timeoutId);
        pending = null;
        reject(error instanceof ChallengeKernelError
          ? error
          : new ChallengeKernelError(
            error instanceof Error ? error.message : 'Failed to send challenge to kernel',
          ));
      });
    });
  };

  const runPython = (code: string) => {
    if (pending) {
      throw new Error('A challenge test is already running');
    }

    return new Promise<ChallengeValueArtifact>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!pending) return;
        pending.reject(new ChallengeKernelError(
          `Execution timed out after ${TEST_TIMEOUT_MS / 1000} seconds`,
          { code: 'timeout', phase: 'python' },
        ));
        pending = null;
      }, TEST_TIMEOUT_MS);

      pending = { kind: 'value', resolve, reject, timeoutId, output: [], error: null };

      let sendResult: void | Promise<void>;
      try {
        sendResult = session.send({ type: 'run_python', code });
      } catch (error) {
        clearTimeout(timeoutId);
        pending = null;
        reject(error instanceof ChallengeKernelError
          ? error
          : new ChallengeKernelError(
            error instanceof Error ? error.message : 'Failed to send challenge to kernel',
          ));
        return;
      }

      Promise.resolve(sendResult).catch((error) => {
        clearTimeout(timeoutId);
        pending = null;
        reject(error instanceof ChallengeKernelError
          ? error
          : new ChallengeKernelError(
            error instanceof Error ? error.message : 'Failed to send challenge to kernel',
          ));
      });
    });
  };

  const cancel = () => {
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    pending.reject(new ChallengeKernelError('Execution canceled'));
    pending = null;
  };

  return { handleMessage, execute, runPython, cancel };
}

function classifyExecutionFailure(error: unknown): ChallengeExecutionFailure {
  const message = error instanceof Error ? error.message : 'Unknown execution error';

  const code = error instanceof ChallengeKernelError ? error.code : undefined;
  const normalizedMessage = message.trim();

  if (
    code === 'timeout'
    || /timed out/i.test(normalizedMessage)
  ) {
    return {
      verdict: 'time_limit_exceeded',
      message: `Time Limit Exceeded: ${normalizedMessage}`,
    };
  }

  if (
    code === 'compile_error'
    || /SyntaxError|IndentationError/i.test(normalizedMessage)
    || /name 'solve' is not defined/i.test(normalizedMessage)
  ) {
    return {
      verdict: 'compile_error',
      message: `Compile Error: ${normalizedMessage}`,
    };
  }

  return {
    verdict: 'runtime_error',
    message: `Runtime Error: ${normalizedMessage}`,
  };
}

export async function runTestCases(
  userCode: string,
  challenge: QuantumChallenge,
  testCases: ReadonlyArray<TestCase>,
  framework: Framework,
  platform: PlatformKind,
  shots: number,
  onStart: (index: number) => void,
  onResult: (result: TestCaseResult, index: number) => void,
  onError: (error: string) => void,
): Promise<TestCaseResult[]> {
  const isValueContract = challenge.contract_kind === 'returns_value';

  if (!isValueContract && platform === 'web' && framework !== 'cirq') {
    const message = `This circuit challenge requires the desktop Qiskit kernel. QKD protocol challenges work in browser.`;
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
      const wrappedCode = buildTestCode(userCode, challenge, testCase.params, framework);
      const startTime = performance.now();

      onStart(index);

      try {
        if (isValueContract) {
          const artifact = await driver.runPython(wrappedCode);
          const elapsed = performance.now() - startTime;
          const testResult = validateValueTestCase(testCase, artifact.value, elapsed);
          results.push(testResult);
          onResult(testResult, index);
        } else {
          const artifact = await driver.execute(wrappedCode, shots);
          const elapsed = performance.now() - startTime;
          const testResult = validateTestCase(testCase, artifact.result, elapsed);
          results.push(testResult);
          onResult(testResult, index);
        }
      } catch (err: unknown) {
        const elapsed = performance.now() - startTime;
        const failure = classifyExecutionFailure(err);
        const failedResult: TestCaseResult = {
          testCaseId: testCase.id,
          passed: false,
          score: 0,
          verdict: failure.verdict,
          message: failure.message,
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

export async function inspectChallengeCase(
  userCode: string,
  challenge: QuantumChallenge,
  testCase: TestCase,
  framework: Framework,
  platform: PlatformKind,
  shots: number,
): Promise<{
  snapshot: CircuitSnapshot | null;
  result: SimulationResult | null;
  stdout: string;
  failure?: ChallengeExecutionFailure;
}> {
  const isValueContract = challenge.contract_kind === 'returns_value';

  if (!isValueContract && platform === 'web' && framework !== 'cirq') {
    return {
      snapshot: null,
      result: null,
      stdout: '',
      failure: {
        verdict: 'runtime_error',
        message: `Runtime Error: This circuit challenge requires the desktop Qiskit kernel. QKD protocol challenges work in browser.`,
      },
    };
  }

  let driver:
    | ReturnType<typeof createExecutionDriver>
    | null = null;
  let session: KernelSession | null = null;

  try {
    session = await createKernelSession(platform, (message) => {
      driver?.handleMessage(message);
    });
    driver = createExecutionDriver(session);

    const wrappedCode = buildTestCode(userCode, challenge, testCase.params, framework);
    if (isValueContract) {
      const artifact = await driver.runPython(wrappedCode);
      return {
        snapshot: null,
        result: null,
        stdout: `${artifact.stdout.trim()}\n\nReturned value:\n${JSON.stringify(artifact.value, null, 2)}`,
      };
    }

    const artifact = await driver.execute(wrappedCode, shots);

    return {
      snapshot: artifact.snapshot,
      result: artifact.result,
      stdout: artifact.stdout,
    };
  } catch (error) {
    return {
      snapshot: null,
      result: null,
      stdout: '',
      failure: classifyExecutionFailure(error),
    };
  } finally {
    driver?.cancel();
    session?.close();
  }
}
