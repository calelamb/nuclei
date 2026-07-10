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

  it('has no duplicate tool names', () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers the full local-simulation tool set', () => {
    const names = AGENT_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'apply_patch',
        'compare_quantum_results',
        'estimate_quantum_resources',
        'finish',
        'inspect_project',
        'parse_quantum_program',
        'read_quantum_file',
        'rollback_patch',
        'run_simulation',
        'validate_quantum_program',
      ].sort(),
    );
  });
});
