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

const COMPLETION_SYSTEM_PROMPT = `You are Dirac, a quantum computing code completion engine inside the Nuclei IDE. Complete the next 1-3 lines of quantum computing Python code. Rules:
- Return ONLY the completion code, no explanation, no markdown, no backticks
- Be aware of the framework (Qiskit/Cirq/CUDA-Q) and use correct syntax
- Never suggest gates on qubits that don't exist (respect qubit count)
- After H gate, favor CNOT for Bell state patterns
- After import statements, suggest common setup boilerplate
- After qc.measure, suggest the classical bit mapping
- Match the user's coding style (variable names, spacing)
- If the code is complete, return empty string`;

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
  const recentErrors = terminalOutput.filter((l) => l.startsWith('Error')).slice(-2);
  if (recentErrors.length > 0) {
    context += `Recent errors: ${recentErrors.join('; ')}\n`;
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
        system: COMPLETION_SYSTEM_PROMPT,
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
  const provider = monaco.languages.registerInlineCompletionsProvider('python', {
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
      // Don't trigger in comments or strings
      const lineContent = model.getLineContent(position.lineNumber);
      const beforeCursor = lineContent.slice(0, position.column - 1).trimStart();
      if (beforeCursor.startsWith('#') || beforeCursor.startsWith("'") || beforeCursor.startsWith('"')) {
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
  });

  return provider;
}

export function cancelCompletion() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}
