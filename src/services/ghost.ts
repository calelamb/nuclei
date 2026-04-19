import { callClaude } from './claudeClient';

const SYSTEM_PROMPT = `You are a code completion engine for a quantum computing IDE. The student is mid-line in a Python file targeting a quantum framework. Complete the NEXT single line of code. Output ONLY the code — no explanation, no markdown fences, no trailing comments. If no useful completion is possible, output an empty string.`;

function stripFence(text: string): string {
  const fenceMatch = text.match(/```(?:python)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return text.trim();
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n');
  return nl >= 0 ? text.slice(0, nl).trim() : text.trim();
}

export interface GhostInput {
  prefix: string;
  framework: string;
}

/**
 * Ask Haiku for a one-line continuation given the code written up to the
 * cursor. Graceful-null when there's no prefix (nothing to complete) or
 * when the API call fails.
 */
export async function ghostCompletion(input: GhostInput): Promise<string | null> {
  if (input.prefix.trim().length === 0) return null;

  const userPrompt = [
    `Framework: ${input.framework}`,
    '',
    'Prefix (cursor is at the end):',
    '```python',
    input.prefix.slice(-2000),
    '```',
  ].join('\n');

  const res = await callClaude({ system: SYSTEM_PROMPT, user: userPrompt, maxTokens: 80 });
  if (!res.text) return null;
  const stripped = stripFence(res.text);
  const line = firstLine(stripped);
  return line.length > 0 ? line : null;
}
