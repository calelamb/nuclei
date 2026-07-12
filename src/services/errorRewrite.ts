import { callClaude } from './claudeClient';
import { useWorkspaceStore, type WorkspaceMode } from '../stores/workspaceStore';
import { personaPreamble } from './diracPersona';

// Learn-mode text is unchanged from before PRD 09 (see errorRewrite.test.ts).
const SYSTEM_PROMPT = `You are Dirac, a patient quantum computing tutor. A student's code hit an error. Rewrite the error output (a Python traceback or Q# compiler diagnostic) into a ONE-PARAGRAPH concept-level explanation that a first-semester student can understand. Use quantum-computing vocabulary only when the student's code uses it. If a minimal correct fix exists, include it. For Q# compiler errors, name the construct the student got wrong and show the corrected line.

Respond ONLY with a JSON object matching this shape:
{"explanation": "string", "fix": "string or null"}

Do NOT include any other text before or after the JSON.`;

const RESEARCH_SYSTEM_PROMPT = `${personaPreamble('research')}

A run just failed. Rewrite the error output (a Python traceback or Q# compiler diagnostic) into a TERSE, precise diagnosis: what failed, the most likely root cause, and — if a minimal fix is obvious — the fix. Do not soften or pad; do not explain concepts the user already knows. For Q# compiler errors, name the construct that's wrong and show the corrected line.

Respond ONLY with a JSON object matching this shape:
{"explanation": "string", "fix": "string or null"}

Do NOT include any other text before or after the JSON.`;

function systemPromptFor(mode: WorkspaceMode): string {
  return mode === 'research' ? RESEARCH_SYSTEM_PROMPT : SYSTEM_PROMPT;
}

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

export async function rewriteExecutionError(input: RewriteInput): Promise<RewrittenError | null> {
  const userPrompt = [
    `Framework: ${input.framework}`,
    '',
    'Student code:',
    input.code.slice(0, 2000),
    '',
    'Error output:',
    input.traceback.slice(0, 2500),
  ].join('\n');

  const res = await callClaude({
    system: systemPromptFor(useWorkspaceStore.getState().mode),
    user: userPrompt,
    maxTokens: 500,
  });
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
