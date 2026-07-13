import { useCallback } from 'react';
import { useDiracStore } from '../stores/diracStore';
import type { ToolCall } from '../stores/diracStore';
import { useEditorStore } from '../stores/editorStore';
import { useCircuitStore } from '../stores/circuitStore';
import type { GateHighlight } from '../stores/circuitStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useExerciseStore } from '../stores/exerciseStore';
import type { Exercise } from '../stores/exerciseStore';
import { useLearnStore } from '../stores/learnStore';
import { getLesson, getTrack } from '../data/lessons/tracks';
import { useStudentStore, studentModelToPrompt } from '../stores/studentStore';
import { useHardwareStore } from '../stores/hardwareStore';
import { useCapstoneStore } from '../stores/capstoneStore';
import { useChallengeModeStore } from '../stores/challengeModeStore';
import { DIRAC_API_URL } from '../config/dirac';
import { classifyIntent } from '../services/classify';
import { compose } from '../services/compose';
import { routeChat, selectContextSections, includeExperimentContext } from '../services/diracRouting';
import type { ContextPlan } from '../services/diracRouting';
import { useSettingsStore } from '../stores/settingsStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { personaPreamble } from '../services/diracPersona';
import { useExperimentUiStore } from '../stores/experimentUiStore';
import { useExperimentStore } from '../services/experimentStore';
import { buildExperimentContext } from '../services/experimentContext';
import { buildQecContext } from '../services/qecContext';
import { useQecStore } from '../stores/qecStore';
import { useQecCampaignStore } from '../stores/qecCampaignStore';
import { resolveNoiseModel } from '../types/noiseModel';
import type { RunRecord } from '../types/experiment';

// The capabilities/tools section is appended after the persona preamble
// (see personaPreamble in services/diracPersona.ts) for both workspace
// modes. Concatenated with the Learn persona via '\n\n', this reproduces
// the pre-PRD-09 SYSTEM_PROMPT byte-for-byte — see diracPersona.test.ts.
const CHAT_CAPABILITIES = `When you have tools available:
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

// Exported (only) so diracPersona/useDirac byte-compatibility tests can
// assert the assembled Learn-mode system prompt is unchanged; not part of
// the public hook surface consumed by components.
export function buildSystemPrompt(): string {
  const mode = useWorkspaceStore.getState().mode;
  let prompt = `${personaPreamble(mode)}\n\n${CHAT_CAPABILITIES}`;

  const studentModel = useStudentStore.getState().model;
  if (studentModel.totalCodeExecutions > 0) {
    prompt += '\n\n' + studentModelToPrompt(studentModel);
  }

  // New Learn Mode context (full-page learning)
  const learnState = useLearnStore.getState();
  if (learnState.isLearnMode && learnState.currentTrackId && learnState.currentLessonId) {
    const track = getTrack(learnState.currentTrackId);
    const lesson = getLesson(learnState.currentTrackId, learnState.currentLessonId);
    if (track && lesson) {
      const progress = learnState.lessonProgress[lesson.id];
      const completedCount = learnState.completedLessons.length;
      prompt += `\n\n## Learn Mode Active\nYou are teaching in Learn Mode. The student is on Track "${track.title}", Lesson "${lesson.title}" (${lesson.difficulty}).`;
      prompt += `\nCompleted lessons: ${completedCount}. Current lesson exercises passed: ${progress?.exercisesPassed?.length ?? 0}. Hints used: ${progress?.hintsUsed ?? 0}.`;
      if (learnState.assessedLevel) {
        prompt += `\nAssessed level: ${learnState.assessedLevel}.`;
      }
      prompt += `\n\n### Teaching Notes for This Lesson\n${lesson.diracContext}`;
      prompt += `\n\nIMPORTANT: You are in teaching mode. Be a patient, encouraging tutor. Reference the lesson content the student is currently viewing. Keep explanations aligned with their current difficulty level. Celebrate progress.`;
    }
  }

  const capstone = useCapstoneStore.getState();
  if (capstone.activeProject) {
    const milestone = capstone.activeProject.milestones[capstone.activeMilestoneIndex];
    prompt += `\n\n## Active Capstone Project\nProject: "${capstone.activeProject.title}"\nMilestone ${capstone.activeMilestoneIndex + 1}/${capstone.activeProject.milestones.length}: "${milestone?.title ?? 'Unknown'}"\n${capstone.activeProject.diracGuidancePrompt}`;
    if (milestone) prompt += `\n${milestone.diracPromptAddendum}`;
  }

  const { selectedBackend, backends } = useHardwareStore.getState();
  if (selectedBackend) {
    const backend = backends.find((b) => b.name === selectedBackend);
    if (backend) {
      prompt += `\n\n## Hardware Context\nThe student has selected quantum backend "${backend.name}" (${backend.provider}).\n- Qubits: ${backend.qubitCount}\n- Error rate: ${backend.averageErrorRate}\n- Queue: ${backend.queueLength} jobs\n- Gate set: ${backend.gateSet.join(', ')}\n- Status: ${backend.status}\nHelp them understand hardware constraints, noise, and transpilation. Compare simulator vs hardware results when available.`;
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
  {
    name: 'submit_hardware',
    description: 'Submit the current circuit to run on a real quantum hardware backend.',
    input_schema: {
      type: 'object' as const,
      properties: {
        backend: { type: 'string', description: 'The backend name to submit to (e.g., "sim_qasm", "ibm_brisbane")' },
        shots: { type: 'number', description: 'Number of measurement shots' },
      },
      required: ['backend'],
    },
  },
  {
    name: 'challenge_hint',
    description: 'Provide a hint for the currently active weekly challenge.',
    input_schema: {
      type: 'object' as const,
      properties: {
        hint_level: { type: 'string', enum: ['gentle', 'moderate', 'strong'], description: 'How much to reveal' },
      },
      required: ['hint_level'],
    },
  },
  {
    name: 'glossary_lookup',
    description: 'Look up a quantum computing term in the glossary and include its definition in your response.',
    input_schema: {
      type: 'object' as const,
      properties: {
        term: { type: 'string', description: 'The quantum computing term to look up' },
      },
      required: ['term'],
    },
  },
];

// Chat routing heuristics (tools / thinking / model pick) live in
// services/diracRouting.ts so the Settings → Dirac AI knobs are applied
// in one pure, tested place.

function buildContextBlock(plan: ContextPlan): string {
  const { code, framework } = useEditorStore.getState();
  const snapshot = useCircuitStore.getState().snapshot;
  const { result, terminalOutput } = useSimulationStore.getState();
  const parts: string[] = [];

  parts.push(`## Current Code (${framework})\n\`\`\`python\n${code}\n\`\`\``);

  if (snapshot) {
    parts.push(`## Circuit Summary\n- Framework: ${snapshot.framework}\n- Qubits: ${snapshot.qubit_count}\n- Classical bits: ${snapshot.classical_bit_count}\n- Depth: ${snapshot.depth}\n- Gates: ${snapshot.gates.length} (${[...new Set(snapshot.gates.map((g) => g.type))].join(', ')})`);
  }

  if (plan.results && result) {
    const topProbs = Object.entries(result.probabilities)
      .sort(([, a], [, b]) => b - a)
      .slice(0, plan.probabilityLimit)
      .map(([state, prob]) => `  |${state}⟩: ${(prob * 100).toFixed(1)}%`)
      .join('\n');
    parts.push(`## Simulation Results\n- Execution time: ${result.execution_time_ms}ms\n- Probabilities:\n${topProbs}`);
    if (plan.bloch && result.bloch_coords.length > 0) {
      const bloch = result.bloch_coords
        .map((c, i) => `  q${i}: (${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)})`)
        .join('\n');
      parts.push(`- Bloch coordinates (x, y, z):\n${bloch}`);
    }
  }

  const activeExercise = useExerciseStore.getState().activeExercise;
  if (plan.exercise && activeExercise) {
    parts.push(`## Active Exercise\n- Title: ${activeExercise.title}\n- Topic: ${activeExercise.topic}\n- Difficulty: ${activeExercise.difficulty}\n- Description: ${activeExercise.description}\n- Expected output: ${JSON.stringify(activeExercise.expectedOutput)}`);
  }

  const errors = terminalOutput.filter((l) => l.type === 'stderr');
  if (plan.errors && errors.length > 0) {
    const recentErrors = errors.slice(-plan.errorLineLimit).map((l) => l.text).join('\n');
    parts.push(`## Recent Errors\n\`\`\`\n${recentErrors}\n\`\`\``);
  }

  const { selectedBackend, backends, jobs, results: hwResults } = useHardwareStore.getState();
  if (plan.hardware && selectedBackend) {
    const backend = backends.find((b) => b.name === selectedBackend);
    if (backend) {
      parts.push(`## Hardware Backend\nSelected: ${backend.name} (${backend.provider}, ${backend.qubitCount} qubits, error rate: ${backend.averageErrorRate})`);
    }
    const completedJobs = jobs.filter((j) => j.status === 'complete');
    if (completedJobs.length > 0) {
      const lastJob = completedJobs[completedJobs.length - 1];
      const hwResult = hwResults[lastJob.id];
      if (hwResult) {
        const topHw = Object.entries(hwResult.probabilities)
          .sort(([, a], [, b]) => b - a)
          .slice(0, plan.probabilityLimit)
          .map(([state, prob]) => `  |${state}⟩: ${(prob * 100).toFixed(1)}%`)
          .join('\n');
        parts.push(`## Hardware Results (${lastJob.backend})\n${topHw}`);
      }
    }
  }

  const activeProblem = useChallengeModeStore.getState().activeProblem;
  if (plan.challenge && activeProblem) {
    parts.push(`## Active Challenge\n- Title: ${activeProblem.title}\n- Difficulty: ${activeProblem.difficulty}\n- Description: ${activeProblem.description}`);
  }

  // PRD 09 Phase E (E4) — Research-mode experiment context, minimal (tone/
  // context only — no tools, no autonomy; that's PRD 12). Deliberately NOT
  // gated through `ContextPlan` (see `includeExperimentContext`'s doc
  // comment): it's read directly here, guarded by workspace mode, so Learn
  // mode's context assembly is entirely unaffected.
  const workspaceMode = useWorkspaceStore.getState().mode;
  const contextDepth = useSettingsStore.getState().dirac.contextDepth;
  if (workspaceMode === 'research' && includeExperimentContext(contextDepth)) {
    const experimentUi = useExperimentUiStore.getState();
    const selectedFileName = experimentUi.selectedExperimentFileName;
    const experiment = selectedFileName
      ? useExperimentStore.getState().experiments.find((e) => e.fileName === selectedFileName)
      : undefined;
    if (experiment) {
      const allRuns = useExperimentStore.getState().runsByExperiment[selectedFileName!] ?? [];
      const selectedDirs = experimentUi.compareSelection.length > 0
        ? experimentUi.compareSelection
        : experimentUi.selectedRunDir
          ? [experimentUi.selectedRunDir]
          : [];
      const selectedRuns = selectedDirs
        .map((dir) => allRuns.find((r) => r.dir === dir))
        .filter((r): r is RunRecord => r !== undefined);
      // PRD 10 D8 — QEC campaigns inject a dedicated context (campaign +
      // noise model + current DEM + capped stats rows + Λ); sweep experiments
      // keep the PRD 09 E4 behavior unchanged.
      if (experiment.spec.type === 'qec_campaign') {
        const spec = experiment.spec;
        parts.push(
          buildQecContext({
            campaignName: spec.name,
            spec,
            noiseModel: resolveNoiseModel(spec.noise.model),
            snapshot: useQecStore.getState().snapshot,
            circuit: useCircuitStore.getState().snapshot,
            rows: Object.values(useQecCampaignStore.getState().rowsByStrongId),
            running: useQecCampaignStore.getState().running,
          }),
        );
      } else {
        parts.push(buildExperimentContext({ ...experiment, spec: experiment.spec }, selectedRuns));
      }
    }
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
  } else if (toolCall.name === 'submit_hardware') {
    const { backend, shots } = toolCall.input as { backend: string; shots?: number };
    const hwStore = useHardwareStore.getState();
    const backendInfo = hwStore.backends.find((b) => b.name === backend);
    if (!backendInfo) {
      updateToolCallStatus(toolId, 'executed', `Backend "${backend}" not found. Available: ${hwStore.backends.map((b) => b.name).join(', ')}`);
    } else {
      const job = {
        id: `job-${Date.now()}`, provider: backendInfo.provider, backend,
        submittedAt: new Date().toISOString(), status: 'queued' as const,
        queuePosition: backendInfo.queueLength, shots: shots ?? 1024,
      };
      hwStore.addJob(job);
      updateToolCallStatus(toolId, 'executed', `Job submitted to ${backend} (${shots ?? 1024} shots). Check the Hardware panel for status.`);
    }
  } else if (toolCall.name === 'challenge_hint') {
    const { hint_level } = toolCall.input as { hint_level: string };
    const challenge = useChallengeModeStore.getState().activeProblem;
    if (!challenge) {
      updateToolCallStatus(toolId, 'executed', 'No active challenge. Open Challenge Mode and start a problem first.');
    } else {
      const hintIdx = hint_level === 'gentle' ? 0 : hint_level === 'moderate' ? 1 : 2;
      const hint = challenge.hints[Math.min(hintIdx, challenge.hints.length - 1)] ?? 'No more hints available.';
      updateToolCallStatus(toolId, 'executed', `Hint for "${challenge.title}": ${hint}`);
    }
  } else if (toolCall.name === 'glossary_lookup') {
    const { term: searchTerm } = toolCall.input as { term: string };
    import('../data/glossary').then(({ GLOSSARY_TERMS }) => {
      const found = GLOSSARY_TERMS.find((t) => t.term.toLowerCase() === searchTerm.toLowerCase());
      if (found) {
        updateToolCallStatus(toolId, 'executed', `${found.term}: ${found.plainEnglish}${found.mathDefinition ? ` (${found.mathDefinition})` : ''}`);
      } else {
        updateToolCallStatus(toolId, 'executed', `Term "${searchTerm}" not found in glossary.`);
      }
    });
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

  // API key is now initialized in diracStore (from localStorage / env).
  // No mount-time override needed.

  const sendMessage = useCallback(async (userText: string) => {
    const apiKey = useDiracStore.getState().apiKey;
    if (!apiKey || apiKey.trim() === '') return;

    // Route compose-intent messages through the compose service instead of
    // the normal chat API call. User sees a DiffPreview overlay; chat gets a
    // short explanation recorded in history.
    const intent = classifyIntent(userText);
    if (intent.kind === 'compose') {
      addMessage({ role: 'user', content: userText });
      setLoading(true);
      try {
        const framework = useEditorStore.getState().framework;
        const currentCode = useEditorStore.getState().code;
        const res = await compose({ intent: intent.prompt, framework, currentCode });
        if (res.ok) {
          useDiracStore.getState().setComposePreview({
            intent: intent.prompt,
            code: res.code,
            explanation: res.explanation,
          });
          addMessage({
            role: 'assistant',
            content: res.explanation || 'Here is a draft — press Enter to apply.',
          });
        } else {
          addMessage({
            role: 'assistant',
            content: `I couldn't draft code for that: ${res.error}`,
          });
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    addMessage({ role: 'user', content: userText });
    setLoading(true);

    // Settings → Dirac AI knobs apply to this chat surface only; with the
    // defaults (auto / extended thinking on / standard depth) the route is
    // identical to the pre-settings behavior (see diracRouting.test.ts).
    const diracSettings = useSettingsStore.getState().dirac;
    const context = buildContextBlock(selectContextSections(diracSettings.contextDepth));
    const route = routeChat(userText, diracSettings);
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
        model: route.model,
        max_tokens: route.maxTokens,
        system: buildSystemPrompt(),
        messages: apiMessages,
        stream: true,
      };
      if (route.thinking) {
        body.thinking = { type: 'enabled', budget_tokens: 10000 };
      }
      if (route.tools) {
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
