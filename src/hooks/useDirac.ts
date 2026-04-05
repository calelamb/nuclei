import { useEffect, useCallback } from 'react';
import { useDiracStore } from '../stores/diracStore';
import type { ToolCall } from '../stores/diracStore';
import { useEditorStore } from '../stores/editorStore';
import { useCircuitStore } from '../stores/circuitStore';
import type { GateHighlight } from '../stores/circuitStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useExerciseStore } from '../stores/exerciseStore';
import type { Exercise } from '../stores/exerciseStore';
import { useLearningStore } from '../stores/learningStore';
import { useStudentStore, studentModelToPrompt } from '../stores/studentStore';
import { DIRAC_API_KEY, DIRAC_API_URL, HAIKU_MODEL, SONNET_MODEL } from '../config/dirac';

const SYSTEM_PROMPT = `You are Dirac, an AI teaching assistant for quantum computing, named after physicist Paul Dirac. You live inside Nuclei, a quantum computing IDE.

Your personality:
- Patient, encouraging, and never condescending
- You explain concepts in plain English first, then math if needed
- You can see the user's current code, circuit state, simulation results, and errors
- You're enthusiastic about quantum computing and love helping beginners learn
- Keep responses concise but thorough — aim for clarity over brevity

When you have tools available:
- Use insert_code when the user asks you to write, fix, or change code
- Always explain what the code does before and after insertion
- Use run_simulation to verify your suggestions work
- You can chain: write code → run simulation → explain results
- If your code produces an error, acknowledge it and fix it

You can help with:
- Explaining quantum computing concepts (superposition, entanglement, measurement, gates)
- Writing and debugging Qiskit, Cirq, and CUDA-Q code
- Explaining what the current circuit does step by step
- Interpreting simulation results and probability histograms
- Diagnosing errors with plain-English explanations
- Explaining what specific gates do (with matrix representations if asked)
- Suggesting improvements to quantum circuits`;

function buildSystemPrompt(): string {
  let prompt = SYSTEM_PROMPT;

  const studentModel = useStudentStore.getState().model;
  if (studentModel.totalCodeExecutions > 0) {
    prompt += '\n\n' + studentModelToPrompt(studentModel);
  }

  const { activePath, activeModuleIndex } = useLearningStore.getState();
  if (activePath) {
    const module = activePath.modules[activeModuleIndex];
    if (module) {
      prompt += `\n\n## Current Learning Module\nThe student is on: "${activePath.title}" → "${module.title}"\n\n${module.diracPromptAddendum}`;
    }
  }

  return prompt;
}

const TOOL_DEFINITIONS = [
  {
    name: 'insert_code',
    description: 'Insert or replace code in the user\'s editor. Always explain what the code does before using this tool.',
    input_schema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'The Python code to insert' },
        position: {
          type: 'string',
          enum: ['cursor', 'replace_selection', 'replace_all', 'append'],
          description: 'Where to insert the code. Use replace_all for new circuits, append for additions.',
        },
        description: { type: 'string', description: 'Brief description of what this code does (shown to user)' },
      },
      required: ['code', 'position', 'description'],
    },
  },
  {
    name: 'run_simulation',
    description: 'Execute the current quantum circuit to see results. Use this after inserting code to verify it works.',
    input_schema: {
      type: 'object' as const,
      properties: {
        shots: { type: 'number', description: 'Number of measurement shots (defaults to current setting if omitted)' },
      },
      required: [],
    },
  },
  {
    name: 'highlight_gate',
    description: 'Highlight a specific gate in the circuit diagram to draw the user\'s attention to it while explaining.',
    input_schema: {
      type: 'object' as const,
      properties: {
        gate_index: { type: 'number', description: 'Index of the gate in the circuit\'s gates array (0-based)' },
        style: { type: 'string', enum: ['pulse', 'glow', 'outline'], description: 'Visual highlight style' },
        duration_ms: { type: 'number', description: 'How long to highlight in ms. 0 = persistent until cleared.' },
      },
      required: ['gate_index', 'style'],
    },
  },
  {
    name: 'step_to',
    description: 'Enter step-through mode and advance to a specific gate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        gate_index: { type: 'number', description: 'Gate index to step to (0-based).' },
      },
      required: ['gate_index'],
    },
  },
  {
    name: 'create_exercise',
    description: 'Generate a quantum computing exercise for the student.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short exercise title' },
        topic: { type: 'string', description: 'Topic: Basics, Superposition, Entanglement, Algorithms, or Error Correction' },
        difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
        description: { type: 'string', description: 'Problem description' },
        starter_code: { type: 'string', description: 'Python starter code with TODO comments' },
        expected_probabilities: { type: 'object', description: 'Target probability distribution' },
        hints: { type: 'array', items: { type: 'string' }, description: 'Progressive hints (3-4)' },
      },
      required: ['title', 'topic', 'difficulty', 'description', 'starter_code', 'expected_probabilities', 'hints'],
    },
  },
  {
    name: 'verify_solution',
    description: 'Check the student\'s current code against the active exercise.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

function shouldUseReasoning(userText: string): boolean {
  const lower = userText.toLowerCase();
  if (lower.startsWith('/think')) return true;
  const reasoningKeywords = [
    'optimize', 'simplify', 'reduce gate', 'prove', 'equivalent',
    'why doesn\'t', 'why isn\'t', 'debug', 'what\'s wrong',
    'state vector after', 'state at step', 'entanglement analysis',
    'error propagation', 'decompose', 'verify correctness',
  ];
  return reasoningKeywords.some((kw) => lower.includes(kw));
}

function shouldUseTools(userText: string): boolean {
  const lower = userText.toLowerCase();
  const actionKeywords = [
    'write', 'fix', 'show me', 'insert', 'change', 'create', 'build',
    'make', 'add', 'modify', 'replace', 'implement', 'code', 'generate',
    'run', 'execute', 'simulate', 'try', 'debug', 'correct',
    'highlight', 'step', 'walk through', 'show me the',
    'exercise', 'challenge', 'practice', 'quiz', 'check', 'verify', 'solution',
  ];
  return actionKeywords.some((kw) => lower.includes(kw));
}

function selectModel(userText: string, useTools: boolean): string {
  if (useTools) return SONNET_MODEL;
  const lower = userText.toLowerCase();
  const complexKeywords = [
    'explain', 'why', 'how does', 'what does', 'teach', 'concept',
    'difference between', 'compare', 'derive', 'prove', 'understand',
    'step by step', 'in detail', 'elaborate', 'deep dive',
  ];
  const isComplex = userText.length > 100 || complexKeywords.some((kw) => lower.includes(kw));
  return isComplex ? SONNET_MODEL : HAIKU_MODEL;
}

function buildContextBlock(): string {
  const { code, framework } = useEditorStore.getState();
  const snapshot = useCircuitStore.getState().snapshot;
  const { result, terminalOutput } = useSimulationStore.getState();
  const parts: string[] = [];

  parts.push(`## Current Code (${framework})\n\`\`\`python\n${code}\n\`\`\``);

  if (snapshot) {
    parts.push(`## Circuit Summary\n- Framework: ${snapshot.framework}\n- Qubits: ${snapshot.qubit_count}\n- Classical bits: ${snapshot.classical_bit_count}\n- Depth: ${snapshot.depth}\n- Gates: ${snapshot.gates.length} (${[...new Set(snapshot.gates.map((g) => g.type))].join(', ')})`);
  }

  if (result) {
    const topProbs = Object.entries(result.probabilities)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([state, prob]) => `  |${state}⟩: ${(prob * 100).toFixed(1)}%`)
      .join('\n');
    parts.push(`## Simulation Results\n- Execution time: ${result.execution_time_ms}ms\n- Probabilities:\n${topProbs}`);
    if (result.bloch_coords.length > 0) {
      const bloch = result.bloch_coords
        .map((c, i) => `  q${i}: (${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)})`)
        .join('\n');
      parts.push(`- Bloch coordinates (x, y, z):\n${bloch}`);
    }
  }

  const activeExercise = useExerciseStore.getState().activeExercise;
  if (activeExercise) {
    parts.push(`## Active Exercise\n- Title: ${activeExercise.title}\n- Topic: ${activeExercise.topic}\n- Difficulty: ${activeExercise.difficulty}\n- Description: ${activeExercise.description}\n- Expected output: ${JSON.stringify(activeExercise.expectedOutput)}`);
  }

  const errors = terminalOutput.filter((l) => l.startsWith('Error'));
  if (errors.length > 0) {
    const recentErrors = errors.slice(-3).join('\n');
    parts.push(`## Recent Errors\n\`\`\`\n${recentErrors}\n\`\`\``);
  }

  return parts.join('\n\n');
}

function executeToolById(toolId: string, accepted: boolean) {
  const messages = useDiracStore.getState().messages;
  let toolCall: ToolCall | undefined;
  for (const m of messages) {
    toolCall = m.toolCalls?.find((tc) => tc.id === toolId);
    if (toolCall) break;
  }
  if (!toolCall) return;

  const { updateToolCallStatus } = useDiracStore.getState();

  if (!accepted) {
    updateToolCallStatus(toolId, 'rejected', 'User rejected this action.');
    return;
  }

  if (toolCall.name === 'insert_code') {
    const { code, position } = toolCall.input as { code: string; position: string; description: string };
    const editorStore = useEditorStore.getState();
    switch (position) {
      case 'replace_all':
        editorStore.setCode(code);
        break;
      case 'append':
        editorStore.setCode(editorStore.code + '\n' + code);
        break;
      default:
        editorStore.setCode(editorStore.code + '\n' + code);
        break;
    }
    updateToolCallStatus(toolId, 'accepted', 'Code inserted into editor.');
  } else if (toolCall.name === 'run_simulation') {
    const shots = (toolCall.input.shots as number) ?? undefined;
    if (shots) useSimulationStore.getState().setShots(shots);
    updateToolCallStatus(toolId, 'executed', 'Simulation triggered.');
    import('../App').then(({ getExecute }) => {
      const execute = getExecute();
      if (execute) execute();
    });
  } else if (toolCall.name === 'highlight_gate') {
    const { gate_index, style, duration_ms } = toolCall.input as { gate_index: number; style: 'pulse' | 'glow' | 'outline'; duration_ms?: number };
    const highlight: GateHighlight = { gateIndex: gate_index, style };
    if (duration_ms) highlight.expiresAt = Date.now() + duration_ms;
    useCircuitStore.getState().addHighlight(highlight);
    if (duration_ms && duration_ms > 0) {
      setTimeout(() => {
        const current = useCircuitStore.getState().highlights;
        useCircuitStore.setState({ highlights: current.filter((h) => h.gateIndex !== gate_index) });
      }, duration_ms);
    }
    updateToolCallStatus(toolId, 'executed', `Highlighted gate ${gate_index}.`);
  } else if (toolCall.name === 'step_to') {
    const { gate_index } = toolCall.input as { gate_index: number };
    useCircuitStore.getState().setStepMode(true);
    useCircuitStore.getState().setStepIndex(gate_index);
    updateToolCallStatus(toolId, 'executed', `Stepped to gate ${gate_index}.`);
  } else if (toolCall.name === 'create_exercise') {
    const input = toolCall.input as {
      title: string; topic: string; difficulty: string;
      description: string; starter_code: string;
      expected_probabilities: Record<string, number>; hints: string[];
    };
    const framework = useEditorStore.getState().framework;
    const exercise: Exercise = {
      id: `dynamic-${Date.now()}`,
      title: input.title,
      topic: input.topic,
      difficulty: input.difficulty as Exercise['difficulty'],
      framework,
      description: input.description,
      starterCode: input.starter_code,
      expectedOutput: input.expected_probabilities,
      hints: input.hints,
      isBuiltIn: false,
    };
    useExerciseStore.getState().startExercise(exercise);
    useEditorStore.getState().setCode(exercise.starterCode);
    updateToolCallStatus(toolId, 'executed', `Exercise "${exercise.title}" started.`);
  } else if (toolCall.name === 'verify_solution') {
    const exercise = useExerciseStore.getState().activeExercise;
    if (!exercise) {
      updateToolCallStatus(toolId, 'executed', 'No active exercise to verify.');
      return;
    }
    const result = useSimulationStore.getState().result;
    if (!result) {
      updateToolCallStatus(toolId, 'executed', 'No simulation results. Run the circuit first (Cmd+Enter).');
      return;
    }
    useExerciseStore.getState().incrementAttempts(exercise.id);
    const expected = exercise.expectedOutput;
    let correct = true;
    for (const [state, prob] of Object.entries(expected)) {
      const actual = result.probabilities[state] ?? 0;
      if (Math.abs(actual - prob) > 0.15) { correct = false; break; }
    }
    if (correct) {
      useExerciseStore.getState().markCompleted(exercise.id);
      updateToolCallStatus(toolId, 'executed', 'Correct! The solution matches the expected output.');
    } else {
      const actualStr = Object.entries(result.probabilities)
        .sort(([,a],[,b]) => b - a)
        .slice(0, 4)
        .map(([s, p]) => `|${s}⟩: ${(p*100).toFixed(1)}%`)
        .join(', ');
      updateToolCallStatus(toolId, 'executed', `Not quite right. Got: ${actualStr}. Try again or ask for a hint.`);
    }
  }
}

export function useDirac() {
  const { addMessage, updateLastAssistant, updateLastThinking, updateLastToolCalls, setLoading } = useDiracStore();

  // Initialize API key from config on mount
  useEffect(() => {
    if (DIRAC_API_KEY && DIRAC_API_KEY !== 'sk-ant-api03-PLACEHOLDER_KEY') {
      useDiracStore.getState().setApiKey(DIRAC_API_KEY);
    }
  }, []);

  const sendMessage = useCallback(async (userText: string) => {
    const apiKey = useDiracStore.getState().apiKey || DIRAC_API_KEY;
    if (!apiKey || apiKey === 'sk-ant-api03-PLACEHOLDER_KEY') return;

    addMessage({ role: 'user', content: userText });
    setLoading(true);

    const context = buildContextBlock();
    const useTools = shouldUseTools(userText);
    const useReasoning = shouldUseReasoning(userText);
    const model = useReasoning ? SONNET_MODEL : selectModel(userText, useTools);
    const cleanText = userText.replace(/^\/think\s*/i, '').replace(/^\/explain\s*/i, '').replace(/^\/fix\s*/i, '');

    // Build API messages
    const storeMessages = useDiracStore.getState().messages;
    const apiMessages: Array<{ role: string; content: unknown }> = [];

    for (let i = 0; i < storeMessages.length; i++) {
      const m = storeMessages[i];
      if (m.role === 'user') {
        const isLast = i === storeMessages.length - 1;
        apiMessages.push({
          role: 'user',
          content: isLast ? `<ide_context>\n${context}\n</ide_context>\n\n${m.content}` : m.content,
        });
      } else {
        if (m.toolCalls && m.toolCalls.length > 0) {
          const contentBlocks: unknown[] = [];
          if (m.content) contentBlocks.push({ type: 'text', text: m.content });
          for (const tc of m.toolCalls) {
            contentBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
          }
          apiMessages.push({ role: 'assistant', content: contentBlocks });
          const toolResults = m.toolCalls.map((tc) => ({
            type: 'tool_result' as const,
            tool_use_id: tc.id,
            content: tc.result ?? 'Tool executed.',
          }));
          apiMessages.push({ role: 'user', content: toolResults });
        } else {
          apiMessages.push({ role: 'assistant', content: m.content });
        }
      }
    }

    addMessage({ role: 'assistant', content: '', toolCalls: [] });

    try {
      const body: Record<string, unknown> = {
        model,
        max_tokens: useReasoning ? 16000 : 4096,
        system: buildSystemPrompt(),
        messages: apiMessages,
        stream: true,
      };
      if (useReasoning) {
        body.thinking = { type: 'enabled', budget_tokens: 10000 };
      }
      if (useTools && !useReasoning) {
        body.tools = TOOL_DEFINITIONS;
      }

      const response = await fetch(DIRAC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        updateLastAssistant(`Error: ${response.status} — ${errorText}`);
        setLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        updateLastAssistant('Error: No response stream');
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let textAccumulated = '';
      let thinkingAccumulated = '';
      let currentBlockType: 'text' | 'thinking' | 'tool_use' | null = null;
      const toolCalls: ToolCall[] = [];
      let currentToolIndex = -1;
      let currentToolInput = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === 'content_block_start') {
              if (parsed.content_block?.type === 'thinking') {
                currentBlockType = 'thinking';
              } else if (parsed.content_block?.type === 'tool_use') {
                currentBlockType = 'tool_use';
                currentToolIndex = toolCalls.length;
                currentToolInput = '';
                toolCalls.push({
                  id: parsed.content_block.id,
                  name: parsed.content_block.name,
                  input: {},
                  status: 'pending',
                });
              } else if (parsed.content_block?.type === 'text') {
                currentBlockType = 'text';
              }
            } else if (parsed.type === 'content_block_delta') {
              if (parsed.delta?.type === 'thinking_delta' && parsed.delta.thinking) {
                thinkingAccumulated += parsed.delta.thinking;
                updateLastThinking(thinkingAccumulated);
              } else if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
                textAccumulated += parsed.delta.text;
                updateLastAssistant(textAccumulated);
              } else if (parsed.delta?.type === 'input_json_delta' && parsed.delta.partial_json) {
                currentToolInput += parsed.delta.partial_json;
              }
            } else if (parsed.type === 'content_block_stop') {
              if (currentBlockType === 'tool_use' && currentToolIndex >= 0 && currentToolInput) {
                try {
                  toolCalls[currentToolIndex].input = JSON.parse(currentToolInput);
                } catch {
                  toolCalls[currentToolIndex].input = { _raw: currentToolInput };
                }
                updateLastToolCalls([...toolCalls]);
                currentToolIndex = -1;
                currentToolInput = '';
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }

      if (toolCalls.length > 0) {
        updateLastToolCalls([...toolCalls]);
        for (const tc of toolCalls) {
          if (tc.name === 'highlight_gate' || tc.name === 'step_to' || tc.name === 'create_exercise' || tc.name === 'verify_solution') {
            setTimeout(() => executeToolById(tc.id, true), 0);
          }
        }
      }

      setLoading(false);
    } catch (e) {
      updateLastAssistant(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      setLoading(false);
    }
  }, [addMessage, updateLastAssistant, updateLastThinking, updateLastToolCalls, setLoading]);

  const handleToolAction = useCallback((toolId: string, accepted: boolean) => {
    executeToolById(toolId, accepted);
  }, []);

  return { sendMessage, handleToolAction };
}
