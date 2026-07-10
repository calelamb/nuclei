import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS } from './tools';

describe('AGENT_TOOLS', () => {
  it('every schema pins additionalProperties to false', () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.input_schema.additionalProperties).toBe(false);
    }
  });

  it('every schema declares an explicit required list', () => {
    for (const tool of AGENT_TOOLS) {
      expect(Array.isArray(tool.input_schema.required)).toBe(true);
    }
  });

  it('every schema is a JSON object schema', () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.input_schema.type).toBe('object');
      expect(typeof tool.input_schema.properties).toBe('object');
    }
  });

  it('includes a finish tool requiring summary and success', () => {
    const finish = AGENT_TOOLS.find((t) => t.name === 'finish');
    expect(finish).toBeDefined();
    expect(finish?.input_schema.required).toEqual(expect.arrayContaining(['summary', 'success']));
  });

  it('includes a plan_hardware_run tool with an optional path input', () => {
    const plan = AGENT_TOOLS.find((t) => t.name === 'plan_hardware_run');
    expect(plan).toBeDefined();
    expect(plan?.input_schema.required).toEqual([]);
    expect(Object.keys(plan?.input_schema.properties ?? {})).toEqual(['path']);
  });

  it('includes a check_algorithm_invariant tool with optional algorithm and tolerance inputs', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'check_algorithm_invariant');
    expect(tool).toBeDefined();
    expect(tool?.input_schema.required).toEqual([]);
    expect(Object.keys(tool?.input_schema.properties ?? {})).toEqual(
      expect.arrayContaining(['algorithm', 'tolerance']),
    );
  });

  it('has no duplicate tool names', () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers the full local-simulation plus hardware tool set', () => {
    const names = AGENT_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'analyze_hardware_result',
        'apply_patch',
        'cancel_hardware_job',
        'check_algorithm_invariant',
        'compare_quantum_results',
        'estimate_quantum_resources',
        'finish',
        'inspect_project',
        'parse_quantum_program',
        'plan_hardware_run',
        'poll_hardware_job',
        'read_quantum_file',
        'rollback_patch',
        'run_simulation',
        'submit_hardware_job',
        'validate_quantum_program',
      ].sort(),
    );
  });

  it('submit_hardware_job requires backend and shots', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'submit_hardware_job');
    expect(tool).toBeDefined();
    expect(tool?.input_schema.required).toEqual(expect.arrayContaining(['backend', 'shots']));
  });

  it('poll_hardware_job and cancel_hardware_job require job_id', () => {
    for (const name of ['poll_hardware_job', 'cancel_hardware_job']) {
      const tool = AGENT_TOOLS.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool?.input_schema.required).toEqual(['job_id']);
    }
  });

  it('analyze_hardware_result requires job_id and allows optional expected_probabilities', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'analyze_hardware_result');
    expect(tool).toBeDefined();
    expect(tool?.input_schema.required).toEqual(['job_id']);
    expect(Object.keys(tool?.input_schema.properties ?? {})).toEqual(
      expect.arrayContaining(['job_id', 'expected_probabilities']),
    );
  });
});
