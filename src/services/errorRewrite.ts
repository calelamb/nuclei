import { callClaude } from './claudeClient';

const SYSTEM_PROMPT = `You are Dirac, a patient quantum computing tutor. A student's code hit an error. Rewrite the Python traceback into a ONE-PARAGRAPH concept-level explanation that a first-semester student can understand. Use quantum-computing vocabulary only when the student's code uses it. If a minimal correct fix exists, include it.

Respond ONLY with a JSON object matching this shape:
{"explanation": "string", "fix": "string or null"}

Do NOT include any other text before or after the JSON.`;

export interface RewriteInput {
  code: string;
  framework: string;
  traceback: string;
}

export interface RewrittenError {
  explanation: string;
  fix: string | null;
}

function extractJson(raw: string): unknown | null {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenceMatch ? fenceMatch[1].trim() : raw.trim();
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function rewritePythonError(input: RewriteInput): Promise<RewrittenError | null> {
  const userPrompt = [
    `Framework: ${input.framework}`,
    '',
    'Student code:',
    input.code.slice(0, 2000),
    '',
    'Traceback:',
    input.traceback.slice(0, 2500),
  ].join('\n');

  const res = await callClaude({ system: SYSTEM_PROMPT, user: userPrompt, maxTokens: 500 });
  if (!res.text) return null;

  const parsed = extractJson(res.text);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const explanation = obj.explanation;
  if (typeof explanation !== 'string' || explanation.length === 0) return null;

  const fixRaw = obj.fix;
  const fix = typeof fixRaw === 'string' && fixRaw.length > 0 ? fixRaw : null;
  return { explanation, fix };
}
