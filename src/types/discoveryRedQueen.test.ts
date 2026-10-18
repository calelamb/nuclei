import { describe, expect, it } from 'vitest';
import { parseDiscoveryYaml } from './discovery';

const BASE = `
schema: 1
type: discovery
program: discovery/w_state.py
evaluator:
  kind: state_synthesis
`;

const parse = (extra: string) => parseDiscoveryYaml(`${BASE}${extra}`, 'rq.discovery.yaml');

describe('Red Queen schema', () => {
  it('accepts mutator.kind red_queen without a red_queen block (defaults are applied by redQueenConfig)', () => {
    const res = parse('mutator:\n  kind: red_queen\n');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.spec.mutator.kind).toBe('red_queen');
      expect(res.spec.red_queen).toBeUndefined();
    }
  });

  it('fills the red_queen block defaults', () => {
    const res = parse('mutator:\n  kind: red_queen\nred_queen: {}\n');
    expect(res.ok && res.spec.red_queen).toEqual({ audit_every: 'improvement', top_k: 5, max_audits: 50 });
  });

  it('parses an explicit block', () => {
    const res = parse('mutator:\n  kind: red_queen\nred_queen:\n  audit_every: top_k\n  top_k: 3\n  max_audits: 12\n');
    expect(res.ok && res.spec.red_queen).toEqual({ audit_every: 'top_k', top_k: 3, max_audits: 12 });
  });

  it('does not change specs without the block', () => {
    const res = parse('');
    expect(res.ok && 'red_queen' in res.spec).toBe(false);
  });

  it.each([
    ['audit_every: sometimes', /red_queen\.audit_every must be one of improvement, all, top_k/],
    ['top_k: 0', /red_queen\.top_k must be at least 1/],
    ['top_k: 2.5', /red_queen\.top_k must be a whole number/],
    ['max_audits: 0', /red_queen\.max_audits must be at least 1/],
    ['max_audits: 5001', /red_queen\.max_audits must be at most 5000/],
  ])('rejects %s with the permitted range', (line, message) => {
    const res = parse(`mutator:\n  kind: red_queen\nred_queen:\n  ${line}\n`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join()).toMatch(message);
  });

  it('rejects unknown keys in the block and unknown mutator kinds', () => {
    expect(parse('red_queen:\n  nope: 1\n').ok).toBe(false);
    expect(parse('mutator:\n  kind: adversary\n').ok).toBe(false);
  });
});
