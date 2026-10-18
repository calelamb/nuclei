import { describe, expect, it } from 'vitest';
import { ATTACK_CLASSES, buildRedQueenSystemPrompt, buildRedQueenUserPrompt, findingsSections, type AuditFinding } from './redQueenPrompt';
import { buildSystemPrompt } from './prompt';
import { SEED_PROGRAM, TOY_EVALUATOR, makeEvaluation } from './testkit';

const system = () => buildRedQueenSystemPrompt({ evaluator: TOY_EVALUATOR, task: 'Make IMPROVE larger.', entry: 'build' });

const exploit: AuditFinding = {
  candidateId: 'c-0004', verdict: 'exploit', gap: 4.8, reasons: ['determinism only under the evaluator seed'], failedChecks: ['Deterministic under a fresh seed'],
};
const agreed: AuditFinding = { candidateId: 'c-0005', verdict: 'consistent', gap: 0, reasons: [], failedChecks: [] };

const base = {
  parent: { id: 'c-0003', program: SEED_PROGRAM, evaluation: makeEvaluation({ fitness: 2.5 }) },
  inspirations: [],
  rejections: [{ guardrail: 'parse', message: 'no IMPROVE constant', count: 2 }],
  findings: [exploit, agreed],
  generation: 4, generations: 25, island: 1, islands: 3, bestFitness: 1004.8,
};

describe('buildRedQueenSystemPrompt', () => {
  it('is one ephemeral-cached text block and differs from the standard persona', () => {
    const blocks = system();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0].text).not.toBe(buildSystemPrompt({ evaluator: TOY_EVALUATOR, task: 'Make IMPROVE larger.', entry: 'build' })[0].text);
  });

  it('frames the work honestly as security testing of our own evaluator', () => {
    const text = system()[0].text;
    expect(text).toContain('security test of Nuclei\'s own evaluator');
    expect(text).toContain('authorized security testing of scoring logic');
    expect(text).toContain('on their own machine');
  });

  it('lists the guardrails and the reward', () => {
    const text = system()[0].text;
    expect(text).toContain('ir_conversion');
    expect(text).toContain('scores WELL under the evaluator');
    expect(text).toContain('FAIL an independent, stricter audit');
    expect(text).toContain('gap between the evaluator');
  });

  it('names every attack class', () => {
    const text = system()[0].text;
    for (const a of ATTACK_CLASSES) expect(text).toContain(`- ${a.id}:`);
    expect(ATTACK_CLASSES.map((a) => a.id)).toEqual(['smuggling', 'determinism', 'cost_model', 'environment_sensing', 'conversion_mismatch']);
  });

  it('forbids attacking the host', () => {
    const text = system()[0].text;
    expect(text).toContain('Never attack the host: no network access, no filesystem writes, no attempts to escape or probe the sandbox');
    expect(text).toContain('The target is the scoring logic only');
  });

  it('matches the snapshot', () => {
    expect(system()[0].text).toMatchSnapshot();
  });
});

describe('buildRedQueenUserPrompt', () => {
  it('tells the model what was already caught and what did not pay', () => {
    const text = buildRedQueenUserPrompt(base);
    expect(text).toContain('## Exploits already found');
    expect(text).toContain('try something different');
    expect(text).toContain('- c-0004 (exploit, gap 4.8): determinism only under the evaluator seed');
    expect(text).toContain('## Audited candidates the audit did NOT reject');
    expect(text).toContain('- c-0005 (consistent, gap 0): no reason given');
  });

  it('includes the guardrail rejections', () => {
    expect(buildRedQueenUserPrompt(base)).toContain('- parse (x2): no IMPROVE constant');
  });

  it('omits the findings sections when there are none', () => {
    const text = buildRedQueenUserPrompt({ ...base, findings: [], rejections: [] });
    expect(text).not.toContain('Exploits already found');
    expect(text).not.toContain('did NOT reject');
    expect(text).not.toContain('Guardrail rejections');
    expect(text).toContain('Best adversarial fitness so far');
  });

  it('shows only the most recent findings', () => {
    const many = Array.from({ length: 12 }, (_, i): AuditFinding => ({ ...exploit, candidateId: `c-${String(i).padStart(4, '0')}` }));
    const sections = findingsSections(many).join('\n');
    expect(sections).not.toContain('c-0000 (');
    expect(sections).toContain('c-0011 (');
  });

  it('matches the snapshot', () => {
    expect(buildRedQueenUserPrompt(base)).toMatchSnapshot();
  });
});
