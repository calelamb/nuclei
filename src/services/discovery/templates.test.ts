import { describe, expect, it } from 'vitest';
import { parseDiscoveryYaml, EVOLVE_END_MARKER, EVOLVE_START_MARKER } from '../../types/discovery';
import { findRegion } from './diff';
import { DISCOVERY_TEMPLATES, getTemplate, scaffoldDiscovery, slugifyName } from './templates';

describe('templates', () => {
  it('ships the four templates with distinct evaluator kinds', () => {
    expect(DISCOVERY_TEMPLATES.map((t) => t.id)).toEqual(['qec-repetition-schedule', 'w-state-synthesis', 'tfim-ansatz', 'trainability-frontier']);
    expect(new Set(DISCOVERY_TEMPLATES.map((t) => t.evaluatorKind)).size).toBe(4);
  });

  it.each(DISCOVERY_TEMPLATES)('$id: seed has exactly one EVOLVE block and a build entry', (t) => {
    const found = findRegion(t.seedProgram);
    expect(found.ok && !found.region.wholeFile).toBe(true);
    expect(t.seedProgram.split(EVOLVE_START_MARKER)).toHaveLength(2);
    expect(t.seedProgram.split(EVOLVE_END_MARKER)).toHaveLength(2);
    expect(t.seedProgram).toMatch(/def build\(/);
  });

  it('seeds respect each evaluator contract', () => {
    const qec = getTemplate('qec-repetition-schedule')!.seedProgram;
    expect(qec).toContain('OBSERVABLE_INCLUDE');
    expect(qec).toContain('DETECTOR');
    expect(qec).not.toMatch(/DEPOLARIZE|X_ERROR|Z_ERROR|PAULI_CHANNEL/);
    expect(qec).toMatch(/def build\(distance, rounds\)/);
    expect(getTemplate('trainability-frontier')!.seedProgram).toMatch(/def build\(n_qubits: int, n_layers: int\)/);
    for (const id of ['w-state-synthesis', 'tfim-ansatz', 'trainability-frontier']) {
      expect(getTemplate(id)!.seedProgram).not.toMatch(/initialize|StatePreparation|measure/);
    }
  });
});

describe('scaffoldDiscovery', () => {
  it.each(DISCOVERY_TEMPLATES)('$id scaffolds a schema-valid definition', (t) => {
    const res = scaffoldDiscovery(t.id, 'My Study 1', { max_evaluations: 50 }, { kind: 'ast' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.definitionPath).toBe('experiments/my-study-1.discovery.yaml');
    expect(res.programPath).toBe('discovery/my-study-1.py');
    expect(res.files.map((f) => f.path)).toEqual([res.definitionPath, res.programPath]);
    const parsed = parseDiscoveryYaml(res.files[0].content, 'my-study-1.discovery.yaml');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.spec.budget.max_evaluations).toBe(50);
      expect(parsed.spec.mutator.kind).toBe('ast');
      expect(parsed.spec.program).toBe('discovery/my-study-1.py');
      expect(parsed.spec.evaluator.kind).toBe(t.evaluatorKind);
      expect(parsed.spec.search.archive.descriptors).toEqual(t.archive.descriptors);
    }
    expect(res.files[1].content).toBe(t.seedProgram);
  });

  it('is pure and deterministic', () => {
    expect(scaffoldDiscovery('tfim-ansatz', 'a')).toEqual(scaffoldDiscovery('tfim-ansatz', 'a'));
  });

  it('reports bad input as data', () => {
    expect(scaffoldDiscovery('nope', 'a')).toMatchObject({ ok: false });
    expect(scaffoldDiscovery('tfim-ansatz', '  !!  ')).toMatchObject({ ok: false });
    const bad = scaffoldDiscovery('tfim-ansatz', 'a', { max_evaluations: 0 });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('budget.max_evaluations');
  });

  it('slugifies names', () => {
    expect(slugifyName('  W State / v2 ')).toBe('w-state-v2');
  });
});
