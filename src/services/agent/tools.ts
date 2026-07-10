import type { AgentToolSchema } from './interfaces';

// Local-simulation tool set for the closed-loop agent, a shadow-mode
// hardware analysis tool (plan_hardware_run), and a POLICY-GATED hardware
// submission/monitoring tool set (submit_hardware_job, poll_hardware_job,
// cancel_hardware_job, analyze_hardware_result). Real-hardware submission is
// never autonomous by default — see policy.ts and hardwareSubmitExecutors.ts.
// Every schema pins `additionalProperties: false` and an explicit `required`
// list so the model (and tests) can rely on strict, minimal inputs.

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

export const VALIDATE_QUANTUM_PROGRAM_TOOL: AgentToolSchema = {
  name: 'validate_quantum_program',
  description:
    'Parse the program and run structural/semantic validators (out-of-range qubits, control/target ' +
    'collisions, gate arity mismatches, empty circuits); returns a list of diagnostics.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path; defaults to the active file.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const ESTIMATE_QUANTUM_RESOURCES_TOOL: AgentToolSchema = {
  name: 'estimate_quantum_resources',
  description: 'Parse the program and report qubit/gate/depth resource metrics, without running a simulation.',
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

export const PLAN_HARDWARE_RUN_TOOL: AgentToolSchema = {
  name: 'plan_hardware_run',
  description:
    'SHADOW MODE ONLY: analyze the parsed circuit against currently known hardware backends and recommend ' +
    "a compatible one with an explainable score. This is a recommendation for the user's consideration — " +
    'it never submits a job or contacts a provider.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path; defaults to the active file.' },
    },
    required: [],
    additionalProperties: false,
  },
};

export const SUBMIT_HARDWARE_JOB_TOOL: AgentToolSchema = {
  name: 'submit_hardware_job',
  description:
    'Submit the active circuit to a named hardware backend for execution. POLICY-GATED: a real, paid QPU ' +
    'submission is only ever sent if a human has explicitly enabled autonomous hardware submission in ' +
    "Settings; otherwise this returns a needs_approval (or deny) result and NOTHING is submitted — that is " +
    'the expected, safe outcome, not an error. Simulator backends run for free under the separate simulator ' +
    'policy toggle. Never retry this tool to try to force a submission after a needs_approval or deny result ' +
    '— report the outcome to the user instead.',
  input_schema: {
    type: 'object',
    properties: {
      backend: { type: 'string', description: 'Name of the backend to submit to.' },
      shots: { type: 'number', description: 'Number of shots to request.' },
    },
    required: ['backend', 'shots'],
    additionalProperties: false,
  },
};

export const POLL_HARDWARE_JOB_TOOL: AgentToolSchema = {
  name: 'poll_hardware_job',
  description: 'Check the current status and queue position of a previously submitted hardware job.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'The job id returned by submit_hardware_job.' },
    },
    required: ['job_id'],
    additionalProperties: false,
  },
};

export const CANCEL_HARDWARE_JOB_TOOL: AgentToolSchema = {
  name: 'cancel_hardware_job',
  description: 'Cancel a previously submitted, still-pending hardware job.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'The job id to cancel.' },
    },
    required: ['job_id'],
    additionalProperties: false,
  },
};

export const ANALYZE_HARDWARE_RESULT_TOOL: AgentToolSchema = {
  name: 'analyze_hardware_result',
  description:
    'Fetch the measured probabilities for a completed hardware job, optionally comparing them against an ' +
    'expected distribution the same way compare_quantum_results does for local simulations.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'The job id to fetch results for.' },
      expected_probabilities: {
        type: 'object',
        description: 'Optional map of measured bitstring state to expected probability (0-1).',
        additionalProperties: { type: 'number' },
      },
    },
    required: ['job_id'],
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
  VALIDATE_QUANTUM_PROGRAM_TOOL,
  ESTIMATE_QUANTUM_RESOURCES_TOOL,
  RUN_SIMULATION_TOOL,
  COMPARE_QUANTUM_RESULTS_TOOL,
  PLAN_HARDWARE_RUN_TOOL,
  SUBMIT_HARDWARE_JOB_TOOL,
  POLL_HARDWARE_JOB_TOOL,
  CANCEL_HARDWARE_JOB_TOOL,
  ANALYZE_HARDWARE_RESULT_TOOL,
  FINISH_TOOL,
];
