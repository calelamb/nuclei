import { callClaude } from './claudeClient';
import type { CircuitSnapshot, SimulationResult } from '../types/quantum';

const SYSTEM_PROMPT = `You are Dirac, a friendly quantum computing tutor embedded in an IDE. The student just changed their code. Your job is to narrate what their circuit is doing right now in ONE short sentence (max 120 characters). No preamble, no "here's what happened", just the observation. If there's nothing interesting yet, return an empty string.`;

function firstLine(text: string): string {
  const trimmed = text.trim();
  const nl = trimmed.indexOf('\n');
  return nl >= 0 ? trimmed.slice(0, nl).trim() : trimmed;
}

function summarizeGates(snapshot: CircuitSnapshot): string {
  const count = snapshot.gates.length;
  if (count === 0) return 'no gates yet';
  const types = [...new Set(snapshot.gates.map((g) => g.type))].slice(0, 6).join(', ');
  return `${count} gate${count === 1 ? '' : 's'} (${types})`;
}

function summarizeProbs(probs: Record<string, number>): string {
  const top = Object.entries(probs)
    .filter(([, p]) => p > 1e-6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s, p]) => `|${s}⟩ ${Math.round(p * 100)}%`)
    .join(', ');
  return top || '(no outcomes above threshold)';
}

export interface NarrateParseInput {
  code: string;
  snapshot: CircuitSnapshot | null;
}

export async function narrateParse(input: NarrateParseInput): Promise<string | null> {
  if (!input.snapshot) return null;
  const prompt = [
    `Framework: ${input.snapshot.framework}`,
    `Qubits: ${input.snapshot.qubit_count}, depth ${input.snapshot.depth}, ${summarizeGates(input.snapshot)}`,
    '',
    'Code:',
    input.code.slice(0, 1500),
  ].join('\n');

  const res = await callClaude({ system: SYSTEM_PROMPT, user: prompt, maxTokens: 120 });
  if (!res.text) return null;
  const line = firstLine(res.text);
  return line.length > 0 ? line : null;
}

export interface NarrateResultInput {
  code: string;
  snapshot: CircuitSnapshot | null;
  result: SimulationResult;
}

export async function narrateResult(input: NarrateResultInput): Promise<string | null> {
  const parts = [
    `Framework: ${input.snapshot?.framework ?? 'unknown'}`,
    `Qubits: ${input.snapshot?.qubit_count ?? '?'}`,
    `Probabilities: ${summarizeProbs(input.result.probabilities)}`,
    `Time: ${input.result.execution_time_ms}ms`,
    '',
    'Code:',
    input.code.slice(0, 1500),
  ];
  const res = await callClaude({ system: SYSTEM_PROMPT, user: parts.join('\n'), maxTokens: 120 });
  if (!res.text) return null;
  const line = firstLine(res.text);
  return line.length > 0 ? line : null;
}
