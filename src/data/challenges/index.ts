import type {
  ChallengeArgument,
  ChallengeArgumentType,
  QuantumChallenge,
} from '../../types/challenge';
import { bellStateFactory } from './bellStateFactory';
import { uniformSuperposition } from './uniformSuperposition';
import { quantumParity } from './quantumParity';
import { maxcutSmall } from './maxcutSmall';
import { bernsteinVazirani } from './bernsteinVazirani';
import { quantumTeleportation } from './quantumTeleportation';
import { groversSearch } from './groversSearch';
import { maxcutWeighted } from './maxcutWeighted';
import { quantumPhaseEstimation } from './quantumPhaseEstimation';
import { simonsAlgorithm } from './simonsAlgorithm';

const DEFAULT_ENTRYPOINT_NAME = 'solve';

function inferArgumentType(value: unknown): ChallengeArgumentType {
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number';
    case 'boolean':
      return 'boolean';
    case 'string':
      return 'string';
    case 'object':
      return value === null ? 'object' : 'object';
    default:
      return 'object';
  }
}

function describeArgument(name: string): string {
  const label = name.replace(/_/g, ' ');
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} passed in by the test harness.`;
}

function collectArguments(challenge: QuantumChallenge): ChallengeArgument[] {
  const samples = new Map<string, unknown>();

  for (const testCase of challenge.testCases) {
    for (const [key, value] of Object.entries(testCase.params)) {
      if (!samples.has(key)) {
        samples.set(key, value);
      }
    }
  }

  return Array.from(samples.entries()).map(([name, sample]) => ({
    name,
    type: inferArgumentType(sample),
    description: describeArgument(name),
    sample,
  }));
}

function buildStarterTemplate(rawCode: string, args: ChallengeArgument[]): string {
  const lines = rawCode.trim().split('\n');
  const importLines: string[] = [];
  const bodyLines: string[] = [];
  let collectingImports = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (collectingImports && (trimmed.startsWith('import ') || trimmed.startsWith('from '))) {
      importLines.push(line);
      continue;
    }

    collectingImports = false;
    bodyLines.push(line);
  }

  const signature = args.map((arg) => arg.name).join(', ');
  const body = bodyLines
    .join('\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => (line.length > 0 ? `    ${line}` : ''))
    .join('\n');
  const imports = importLines.join('\n');

  return `${imports}

def ${DEFAULT_ENTRYPOINT_NAME}(${signature}):
    """Return a QuantumCircuit for the current challenge."""
${body}
    return qc
`;
}

function normalizeChallenge(challenge: QuantumChallenge): QuantumChallenge {
  const args = collectArguments(challenge);

  return {
    ...challenge,
    default_framework: 'qiskit',
    entrypoint_name: DEFAULT_ENTRYPOINT_NAME,
    contract_kind: 'returns_circuit',
    arguments: args,
    visible_tests: challenge.testCases.filter((testCase) => !testCase.hidden),
    hidden_tests: challenge.testCases.filter((testCase) => testCase.hidden),
    starter_template: buildStarterTemplate(challenge.starterCode.qiskit, args),
  };
}

const RAW_CHALLENGES: QuantumChallenge[] = [
  bellStateFactory,
  uniformSuperposition,
  quantumParity,
  maxcutSmall,
  bernsteinVazirani,
  quantumTeleportation,
  groversSearch,
  maxcutWeighted,
  quantumPhaseEstimation,
  simonsAlgorithm,
];

export const QUANTUM_CHALLENGES: QuantumChallenge[] = RAW_CHALLENGES.map(normalizeChallenge);

export {
  bellStateFactory,
  uniformSuperposition,
  quantumParity,
  maxcutSmall,
  bernsteinVazirani,
  quantumTeleportation,
  groversSearch,
  maxcutWeighted,
  quantumPhaseEstimation,
  simonsAlgorithm,
};
