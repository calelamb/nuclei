import { describe, expect, it } from 'vitest';
import { parseDiscoveryYaml, discoveryBaseName } from './discovery';

const MINIMAL = `
schema: 1
type: discovery
program: discovery/w_state.py
evaluator:
  kind: state_synthesis
`;

describe('parseDiscoveryYaml', () => {
  it('applies every default for a minimal file', () => {
    const res = parseDiscoveryYaml(MINIMAL, 'w-state.discovery.yaml');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.spec.name).toBe('w-state');
    expect(res.spec.entry).toBe('build');
    expect(res.spec.search).toMatchObject({ islands: 3, generations: 25, candidates_per_generation: 6, migration_interval: 5, exploration: 0.15, early_stop_patience: 10 });
    expect(res.spec.evaluation).toEqual({ cascade: true, promote_if: 'island_median' });
    expect(res.spec.mutator).toMatchObject({ kind: 'hybrid', llm_share: 0.75, batch_mode: false, inspirations: 2 });
    expect(res.spec.mutator.models).toEqual({ breadth: 'haiku', depth: 'opus', depth_share: 0.2, depth_thinking: true });
    expect(res.spec.budget).toEqual({ max_evaluations: 200, max_llm_calls: 160, max_wall_minutes: 90, max_concurrent_evaluations: 3 });
    expect(res.spec.confirm.seeds).toBe(3);
  });

  it('parses the full §7.4 example', () => {
    const res = parseDiscoveryYaml(
      `${MINIMAL}
search:
  islands: 3
  archive: { descriptors: [two_qubit_gates, depth], bins: [8, 8] }
mutator:
  kind: hybrid
  models: { breadth: haiku, depth: opus, depth_share: 0.2, depth_thinking: true }
  batch_mode: true
confirm: { seeds: 3 }
seed: 7
notes: hi
`,
      'x.discovery.yaml',
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.spec.search.archive.descriptors).toEqual(['two_qubit_gates', 'depth']);
      expect(res.spec.mutator.batch_mode).toBe(true);
      expect(res.spec.seed).toBe(7);
    }
  });

  it('accepts the legacy single `model` as a breadth-only ensemble', () => {
    const res = parseDiscoveryYaml(`${MINIMAL}\nmutator:\n  kind: llm\n  model: sonnet\n`, 'x.discovery.yaml');
    expect(res.ok && res.spec.mutator.models).toEqual({ breadth: 'sonnet', depth: 'sonnet', depth_share: 0, depth_thinking: false });
  });

  it('rejects out-of-range values with the permitted range in the message', () => {
    const res = parseDiscoveryYaml(`${MINIMAL}\nsearch:\n  islands: 12\n  exploration: 2\nbudget:\n  max_concurrent_evaluations: 0\n`, 'x.discovery.yaml');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors).toContain('search.islands: search.islands must be at most 8');
    expect(res.errors.some((e) => e.includes('exploration') && e.includes('between 0 and 1'))).toBe(true);
    expect(res.errors.some((e) => e.includes('max_concurrent_evaluations') && e.includes('at least 1'))).toBe(true);
  });

  it('rejects unknown keys, bad kinds and identical descriptors', () => {
    expect(parseDiscoveryYaml(`${MINIMAL}\nbogus: 1\n`, 'a.discovery.yaml').ok).toBe(false);
    const kind = parseDiscoveryYaml(MINIMAL.replace('state_synthesis', 'nope'), 'a.discovery.yaml');
    expect(!kind.ok && kind.errors[0]).toContain('evaluator.kind must be one of');
    const same = parseDiscoveryYaml(`${MINIMAL}\nsearch:\n  archive: { descriptors: [a, a] }\n`, 'a.discovery.yaml');
    expect(!same.ok && same.errors.join()).toContain('must be different');
  });

  it('reports YAML syntax errors and non-mappings as data', () => {
    expect(parseDiscoveryYaml('a: [', 'a.discovery.yaml')).toMatchObject({ ok: false });
    expect(parseDiscoveryYaml('- 1', 'a.discovery.yaml')).toEqual({ ok: false, errors: ['discovery file must be a YAML mapping'] });
  });

  it('accepts the trainability_frontier evaluator kind', () => {
    expect(parseDiscoveryYaml(MINIMAL.replace('state_synthesis', 'trainability_frontier'), 'a.discovery.yaml').ok).toBe(true);
  });

  it('derives the base name', () => {
    expect(discoveryBaseName('experiments/a-b.discovery.yaml')).toBe('a-b');
  });
});
