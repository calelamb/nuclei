/**
 * Ghost Completions — Haiku-powered inline autocomplete for quantum code.
 *
 * Registers as a Monaco InlineCompletionProvider. Triggers after 500ms pause.
 * Tab to accept, Esc to dismiss. Cancels in-flight requests on new input.
 */

import { useEditorStore } from '../../../stores/editorStore';
import { useCircuitStore } from '../../../stores/circuitStore';
import { useSimulationStore } from '../../../stores/simulationStore';
import { useDiracStore } from '../../../stores/diracStore';
import { useSettingsStore } from '../../../stores/settingsStore';

const API_URL = 'https://api.anthropic.com/v1/messages';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export const PYTHON_COMPLETION_SYSTEM_PROMPT = `You are Dirac, a quantum computing code completion engine inside the Nuclei IDE. Complete the next 1-3 lines of quantum computing Python code. Rules:
- Return ONLY the completion code, no explanation, no markdown, no backticks
- Be aware of the framework (Qiskit/Cirq/CUDA-Q) and use correct syntax
- Never suggest gates on qubits that don't exist (respect qubit count)
- After H gate, favor CNOT for Bell state patterns
- After import statements, suggest common setup boilerplate
- After qc.measure, suggest the classical bit mapping
- Match the user's coding style (variable names, spacing)
- If the code is complete, return empty string`;

// The Q# rules below are a deliberately distilled subset of QSHARP_STYLE_GUIDE
// (src/services/qsharpStyle.ts), trimmed to fit the token budget of Haiku ghost
// completions. Keep the two in sync manually when the style guide changes.
const QSHARP_COMPLETION_SYSTEM_PROMPT = `You are Dirac, a quantum computing code completion engine inside the Nuclei IDE. Complete the next 1-3 lines of Q# (Microsoft QDK) code. The buffer is Q#, NOT Python — never emit Python syntax. Rules:
- Return ONLY the completion code, no explanation, no markdown, no backticks
- Modern QDK 1.x syntax: top-level operations (no namespace wrapper), \`import Std.*\` (never \`open Microsoft.Quantum.*\`), \`use q = Qubit();\`, measure with \`M(q)\`, Reset/ResetAll qubits before release
- Never suggest gates on qubits that don't exist (respect qubit count)
- Match the user's coding style (variable names, spacing)
- If the code is complete, return empty string`;

/** Pick the completion system prompt for the active framework. */
export function buildCompletionSystemPrompt(framework: string): string {
  return framework === 'qsharp'
    ? QSHARP_COMPLETION_SYSTEM_PROMPT
    : PYTHON_COMPLETION_SYSTEM_PROMPT;
}

/**
 * True when the (left-trimmed) text before the cursor sits inside a comment
 * or string for the given Monaco language id. Q# uses \`//\` comments and
 * \`"\`/\`$"\` strings; Python uses \`#\` and quotes.
 */
export function isInCommentOrString(beforeCursor: string, languageId: string): boolean {
  if (languageId === 'qsharp') {
    return (
      beforeCursor.startsWith('//') ||
      beforeCursor.startsWith('"') ||
      beforeCursor.startsWith('$"')
    );
  }
  return (
    beforeCursor.startsWith('#') ||
    beforeCursor.startsWith("'") ||
    beforeCursor.startsWith('"')
  );
}

/** Monaco language ids that get ghost completions. */
const GHOST_LANGUAGE_IDS = ['python', 'qsharp'] as const;

let abortController: AbortController | null = null;

function buildCompletionContext(code: string, cursorOffset: number): string {
  const beforeCursor = code.slice(0, cursorOffset);
  const afterCursor = code.slice(cursorOffset);
  const framework = useEditorStore.getState().framework;
  const snapshot = useCircuitStore.getState().snapshot;
  const terminalOutput = useSimulationStore.getState().terminalOutput;

  let context = `Framework: ${framework}\n`;
  if (snapshot) {
    context += `Circuit: ${snapshot.qubit_count} qubits, ${snapshot.gates.length} gates, depth ${snapshot.depth}\n`;
  }
  const recentErrors = terminalOutput.filter((l) => l.type === 'stderr').slice(-2);
  if (recentErrors.length > 0) {
    context += `Recent errors: ${recentErrors.map((l) => l.text).join('; ')}\n`;
  }

  return `${context}\nCode before cursor:\n${beforeCursor}\n[CURSOR]\n${afterCursor ? `Code after cursor:\n${afterCursor}` : ''}`;
}

async function fetchCompletion(code: string, cursorOffset: number): Promise<string | null> {
  const apiKey = useDiracStore.getState().apiKey;
  if (!apiKey || apiKey.trim() === '') return null;

  // Cancel previous request
  if (abortController) abortController.abort();
  abortController = new AbortController();

  const context = buildCompletionContext(code, cursorOffset);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 150,
        system: buildCompletionSystemPrompt(useEditorStore.getState().framework),
        messages: [{ role: 'user', content: context }],
      }),
      signal: abortController.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const text = data.content?.[0]?.text?.trim() ?? '';
    return text || null;
  } catch {
    return null; // Aborted or network error
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerGhostCompletions(monaco: any) {
  const provider = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provideInlineCompletions: async (model: any, position: any, _context: any, token: any) => {
      // Respect the per-user toggle — ghost is off by default for beginners.
      if (!useSettingsStore.getState().dirac.ghostCompletions) {
        return { items: [] };
      }
      // Guard against out-of-range line numbers
      const lineCount = model.getLineCount();
      if (position.lineNumber < 1 || position.lineNumber > lineCount) {
        return { items: [] };
      }
      // Don't trigger in comments or strings (per-language syntax)
      const languageId =
        typeof model.getLanguageId === 'function' ? model.getLanguageId() : 'python';
      const lineContent = model.getLineContent(position.lineNumber);
      const beforeCursor = lineContent.slice(0, position.column - 1).trimStart();
      if (isInCommentOrString(beforeCursor, languageId)) {
        return { items: [] };
      }

      const offset = model.getOffsetAt(position);
      const code = model.getValue();

      const completion = await fetchCompletion(code, offset);
      if (token.isCancellationRequested || !completion) {
        return { items: [] };
      }

      return {
        items: [{
          insertText: completion,
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
        }],
      };
    },

    freeInlineCompletions() {},
  };

  const disposables = GHOST_LANGUAGE_IDS.map((id) =>
    monaco.languages.registerInlineCompletionsProvider(id, provider),
  );

  return {
    dispose() {
      for (const d of disposables) d?.dispose?.();
    },
  };
}

export function cancelCompletion() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}
