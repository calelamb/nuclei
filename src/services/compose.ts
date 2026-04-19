import { useDiracStore } from '../stores/diracStore';
import { DIRAC_API_URL, SONNET_MODEL } from '../config/dirac';

const SYSTEM_PROMPT = `You are Dirac, a quantum computing tutor that writes code for students.
You will receive:
- The target framework (cirq, qiskit, cuda-q)
- The student's current code (possibly empty)
- The student's request

ALWAYS respond with exactly one tool_use call to the \`insert_code\` tool. The \`code\` argument must be a COMPLETE, runnable Python file for the target framework. Keep it minimal — the student is learning. Include a short comment that says what the circuit does. Do not include any preamble text in the tool input.

Along with the tool call, include a ONE-SENTENCE plain-text explanation of what the code does.`;

const INSERT_CODE_TOOL = {
  name: 'insert_code',
  description:
    'Insert a complete runnable Python program for the target quantum framework into the editor.',
  input_schema: {
    type: 'object' as const,
    properties: {
      code: { type: 'string' as const, description: 'The full contents of the new editor buffer.' },
    },
    required: ['code'],
  },
};

export interface ComposeInput {
  intent: string;
  framework: string;
  currentCode: string;
}

export interface ComposeOutput {
  code: string;
  explanation: string;
}

/**
 * Result envelope so the caller can surface the actual failure reason
 * instead of a generic "couldn't draft" message. Keeps the happy-path
 * callsite simple: `if (res.ok) use res.code/explanation; else show res.error`.
 */
export type ComposeResult =
  | { ok: true; code: string; explanation: string }
  | { ok: false; error: string };

export async function compose(input: ComposeInput): Promise<ComposeResult> {
  const apiKey = useDiracStore.getState().apiKey;
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: 'No API key set. Add one in Settings → Dirac.' };
  }

  const userPrompt = [
    `Framework: ${input.framework}`,
    '',
    'Student request:',
    input.intent,
    '',
    'Current code (may be empty):',
    '```python',
    input.currentCode,
    '```',
  ].join('\n');

  let response: Response;
  try {
    response = await fetch(DIRAC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: SONNET_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [INSERT_CODE_TOOL],
        tool_choice: { type: 'tool', name: 'insert_code' },
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Network error contacting Anthropic: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!response.ok) {
    // Parse Anthropic's error envelope — it's shaped as
    // { type: 'error', error: { type, message } } per the public API docs.
    let reason = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      const errMsg = body?.error?.message;
      if (typeof errMsg === 'string' && errMsg.length > 0) reason = errMsg;
    } catch {
      // Response wasn't JSON; fall back to raw text.
      try {
        const txt = await response.text();
        if (txt) reason = txt.slice(0, 280);
      } catch { /* noop */ }
    }
    return { ok: false, error: reason };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: 'Anthropic returned a non-JSON response.' };
  }

  const contentArr: Array<Record<string, unknown>> =
    Array.isArray((data as { content?: unknown })?.content)
      ? ((data as { content: unknown }).content as Array<Record<string, unknown>>)
      : [];
  const toolUse = contentArr.find((c) => c.type === 'tool_use' && c.name === 'insert_code');
  const codeRaw = (toolUse?.input as { code?: unknown } | undefined)?.code;
  if (typeof codeRaw !== 'string' || codeRaw.length === 0) {
    return {
      ok: false,
      error: 'Dirac responded but didn\'t produce code. Try rephrasing the request.',
    };
  }

  const explanationBlock = contentArr.find((c) => c.type === 'text');
  const explanation =
    typeof explanationBlock?.text === 'string' ? explanationBlock.text : '';

  return { ok: true, code: codeRaw, explanation };
}
