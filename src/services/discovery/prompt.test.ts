import { describe, expect, it } from 'vitest';
import type { GradientMap } from '../../types/discovery';
import {
  GRADIENT_MAP_MAX_LINES, INSPIRATION_MAX_LINES, buildSystemPrompt, buildUserPrompt, gradientMapSection,
  guardrailsFor, summarizeRejections,
} from './prompt';
import { SEED_PROGRAM, TOY_EVALUATOR, makeEvaluation } from './testkit';

const system = () => buildSystemPrompt({ evaluator: TOY_EVALUATOR, task: 'Make IMPROVE larger.', entry: 'build' });

function gradientMap(lines: number, deadEvery = 3): GradientMap {
  return {
    method: 'pauli_propagation_exact',
    n_qubits: 6,
    dead_fraction: 0.25,
    lines: Array.from({ length: lines }, (_, i) => ({
      line: i + 1, parameters: [`θ[${i}]`], variance: i % deadEvery === 0 ? 1e-10 : 1e-3 * (i + 1), dead: i % deadEvery === 0,
    })),
  };
}

describe('buildSystemPrompt', () => {
  it('is one ephemeral-cached text block', () => {
    const blocks = system();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0].type).toBe('text');
  });

  it('carries persona, task, evaluator, guardrails and rules', () => {
    const text = system()[0].text;
    expect(text).toContain('research collaborator');
    expect(text).toContain('Make IMPROVE larger.');
    expect(text).toContain('err (minimize): Error');
    expect(text).toContain('d1: Lines, range 0 to 10');
    expect(text).toContain('Edit only inside the # EVOLVE-BLOCK-START');
    expect(text).toContain('Never add noise');
    expect(text).toContain('Never read, import, guess or hardcode evaluator internals');
    expect(text).toContain('one small, testable hypothesis');
    expect(text).toContain('ir_conversion');
  });

  it('lists the guardrails of every evaluator kind', () => {
    for (const kind of ['qec_memory', 'state_synthesis', 'vqe_ground_state', 'trainability_frontier'] as const) {
      expect(guardrailsFor(kind).length).toBeGreaterThan(3);
    }
    expect(guardrailsFor('qec_memory').map((g) => g.id)).toContain('fault_distance');
  });

  it('matches the snapshot', () => {
    expect(system()[0].text).toMatchSnapshot();
  });
});

describe('buildUserPrompt', () => {
  const parent = {
    id: 'c-0003',
    program: SEED_PROGRAM,
    evaluation: makeEvaluation({
      fitness: 2.5,
      objectives: { err: { value: 0.003, ci95: [0.002, 0.004], direction: 'minimize', label: 'Error' } },
      guardrails: [{ id: 'fault_distance', label: 'x', status: 'warn', detail: 'verified only up to the search bounds' }],
    }),
  };
  const base = {
    parent, inspirations: [], rejections: [], generation: 4, generations: 25, island: 1, islands: 3, bestFitness: 2.5,
  };

  it('shows the parent, its evaluation with CIs and guardrail warnings, and the context', () => {
    const text = buildUserPrompt(base);
    expect(text).toContain('Generation 4 of 25, island 2 of 3');
    expect(text).toContain('## Parent program (c-0003)');
    expect(text).toContain('IMPROVE = 0');
    expect(text).toContain('err = 0.003 (95% CI 0.002 to 0.004) [minimize]');
    expect(text).toContain('guardrail warning fault_distance: verified only up to the search bounds');
    expect(text).not.toContain('Gradient map');
    expect(text).not.toContain('Inspirations');
  });

  it('truncates inspirations with an explicit N of M disclosure', () => {
    const long = Array.from({ length: 150 }, (_, i) => `line_${i} = ${i}`).join('\n');
    const text = buildUserPrompt({
      ...base,
      inspirations: [{ id: 'c-0009', program: long, evaluation: makeEvaluation({ fitness: 4 }) }],
    });
    expect(text).toContain(`(showing ${INSPIRATION_MAX_LINES} of 150 lines)`);
    expect(text).toContain('line_59 = 59');
    expect(text).not.toContain('line_60 = 60');
  });

  it('lists the most frequent rejection reasons', () => {
    const rejections = summarizeRejections([
      { guardrail: 'noiseless', message: 'noise found' }, { guardrail: 'noiseless', message: 'noise found' },
      { guardrail: 'parse', message: 'syntax' },
    ]);
    expect(rejections[0]).toMatchObject({ guardrail: 'noiseless', count: 2 });
    expect(buildUserPrompt({ ...base, rejections })).toContain('- noiseless (x2): noise found');
  });

  it('caps the rejection summary', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ guardrail: `g${i}`, message: 'm' }));
    expect(summarizeRejections(many)).toHaveLength(5);
  });

  it('matches the snapshot with inspirations and rejections', () => {
    expect(
      buildUserPrompt({
        ...base,
        inspirations: [{ id: 'c-0001', program: 'IMPROVE = 9\nx = 1', evaluation: makeEvaluation({ fitness: 9 }) }],
        rejections: [{ guardrail: 'noiseless', message: 'noise found', count: 2 }],
      }),
    ).toMatchSnapshot();
  });
});

describe('gradient map section (addendum C)', () => {
  const source = Array.from({ length: 30 }, (_, i) => `qc.ry(theta[${i}], ${i % 6})`).join('\n');

  it('is absent without a map', () => {
    expect(gradientMapSection(undefined, source)).toBe('');
  });

  it('caps at 12 lines with N of M, lists dead lines first and suggests fixes', () => {
    const section = gradientMapSection(gradientMap(30), source);
    expect(section).toContain('### Gradient map (from the trusted evaluator)');
    expect(section).toContain(`(showing ${GRADIENT_MAP_MAX_LINES} of 30 lines; dead lines first)`);
    expect(section.split('\n').filter((l) => l.startsWith('- line '))).toHaveLength(GRADIENT_MAP_MAX_LINES);
    expect(section).toContain('- line 1 [DEAD]');
    expect(section).toContain('| qc.ry(theta[0], 0)');
    expect(section).toContain('10 of 30 mapped lines are dead');
    expect(section).toMatch(/pruning them, reordering them, or changing their rotation axis/);
  });

  it('flows into the user prompt when the parent evaluation has a map', () => {
    const text = buildUserPrompt({
      parent: { id: 'c-0001', program: source, evaluation: makeEvaluation({ metrics: { gradient_map: gradientMap(4) } }) },
      inspirations: [], rejections: [], generation: 1, generations: 2, island: 0, islands: 1, bestFitness: null,
    });
    expect(text).toContain('Gradient map (from the trusted evaluator)');
    expect(text).toContain('Best fitness so far: none yet');
  });

  it('matches the snapshot', () => {
    expect(gradientMapSection(gradientMap(14), source)).toMatchSnapshot();
  });
});
