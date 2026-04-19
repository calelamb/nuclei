import { useDiracStore } from '../stores/diracStore';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const SONNET_MODEL = 'claude-sonnet-4-6-20250514';

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

export async function compose(input: ComposeInput): Promise<ComposeOutput | null> {
  const apiKey = useDiracStore.getState().apiKey;
  if (!apiKey || !apiKey.trim()) return null;

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

  try {
    const response = await fetch(ANTHROPIC_URL, {
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
    if (!response.ok) return null;

    const data = await response.json();
    const contentArr: Array<Record<string, unknown>> = Array.isArray(data?.content) ? data.content : [];

    const toolUse = contentArr.find((c) => c.type === 'tool_use' && c.name === 'insert_code');
    const codeRaw = (toolUse?.input as { code?: unknown } | undefined)?.code;
    if (typeof codeRaw !== 'string' || codeRaw.length === 0) return null;

    const explanationBlock = contentArr.find((c) => c.type === 'text');
    const explanation =
      typeof explanationBlock?.text === 'string' ? explanationBlock.text : '';

    return { code: codeRaw, explanation };
  } catch {
    return null;
  }
}
