import type { AgentToolSchema } from './interfaces';

// Local-simulation-only tool set for the closed-loop agent. No hardware
// tools here — hardware submission is out of scope for this task. Every
// schema pins `additionalProperties: false` and an explicit `required` list
// so the model (and tests) can rely on strict, minimal inputs.

export const INSPECT_PROJECT_TOOL: AgentToolSchema = {
  name: 'inspect_project',
  description: 'List every file currently in the workspace along with which one is active.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

export const READ_QUANTUM_FILE_TOOL: AgentToolSchema = {
  name: 'read_quantum_file',
  description: 'Read the full current contents of a quantum program file in the workspace.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path to read.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

export const APPLY_PATCH_TOOL: AgentToolSchema = {
  name: 'apply_patch',
  description:
    'Apply a reversible, journaled edit that replaces the full contents of a file. Conflict-checked ' +
    'against the last content this agent observed for the path.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path to write.' },
      new_content: { type: 'string', description: 'The complete new contents of the file.' },
      rationale: { type: 'string', description: 'One-sentence reason for this edit.' },
    },
    required: ['path', 'new_content', 'rationale'],
    additionalProperties: false,
  },
};

export const ROLLBACK_PATCH_TOOL: AgentToolSchema = {
  name: 'rollback_patch',
  description: 'Revert a previously applied patch by its transaction id.',
  input_schema: {
    type: 'object',
    properties: {
      transaction_id: { type: 'string', description: 'The id returned by a prior apply_patch call.' },
    },
    required: ['transaction_id'],
    additionalProperties: false,
  },
};

export const PARSE_QUANTUM_PROGRAM_TOOL: AgentToolSchema = {
  name: 'parse_quantum_program',
  description: 'Parse and structurally validate a quantum program without running a simulation.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path; defaults to the active file.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const RUN_SIMULATION_TOOL: AgentToolSchema = {
  name: 'run_simulation',
  description: 'Simulate a quantum program locally and return probabilities and measurement facts.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path; defaults to the active file.' },
      shots: { type: 'number', description: 'Number of shots to simulate; defaults to 1024.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const COMPARE_QUANTUM_RESULTS_TOOL: AgentToolSchema = {
  name: 'compare_quantum_results',
  description: "Compare the most recent run_simulation result's probabilities to an expected distribution.",
  input_schema: {
    type: 'object',
    properties: {
      expected_probabilities: {
        type: 'object',
        description: 'Map of measured bitstring state to expected probability (0-1).',
        additionalProperties: { type: 'number' },
      },
      tolerance: { type: 'number', description: 'Allowed absolute delta per state; defaults to 0.05.' },
    },
    required: ['expected_probabilities'],
    additionalProperties: false,
  },
};

export const FINISH_TOOL: AgentToolSchema = {
  name: 'finish',
  description: 'Terminate the run with a final summary and a verdict on whether the goal was met.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Plain-English summary of what was done and the outcome.' },
      success: { type: 'boolean', description: 'Whether the success criterion was met.' },
    },
    required: ['summary', 'success'],
    additionalProperties: false,
  },
};

export const AGENT_TOOLS: AgentToolSchema[] = [
  INSPECT_PROJECT_TOOL,
  READ_QUANTUM_FILE_TOOL,
  APPLY_PATCH_TOOL,
  ROLLBACK_PATCH_TOOL,
  PARSE_QUANTUM_PROGRAM_TOOL,
  RUN_SIMULATION_TOOL,
  COMPARE_QUANTUM_RESULTS_TOOL,
  FINISH_TOOL,
];
