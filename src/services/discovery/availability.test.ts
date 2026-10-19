import { describe, expect, it } from 'vitest';
import { TOY_EVALUATOR } from './testkit';
import {
  findEvaluator,
  isEvaluatorAvailable,
  unavailableInstructions,
  unavailableStartMessage,
  unavailableSummary,
} from './availability';
import type { DiscoveryEvaluatorInfo } from '../../types/discovery';

const QEC: DiscoveryEvaluatorInfo = {
  ...TOY_EVALUATOR,
  kind: 'qec_memory',
  available: false,
  missing: ['stim', 'pymatching'],
  install: { catalog_ids: ['stim', 'pymatching'], hint: "Install 'Stim' and 'PyMatching' from the Research catalog in Environment setup." },
};

describe('evaluator availability', () => {
  it('treats a missing or true flag as available (older kernels send none)', () => {
    expect(isEvaluatorAvailable(TOY_EVALUATOR)).toBe(true);
    expect(isEvaluatorAvailable({ ...TOY_EVALUATOR, available: true })).toBe(true);
    expect(isEvaluatorAvailable(undefined)).toBe(true);
    expect(isEvaluatorAvailable(QEC)).toBe(false);
  });

  it('summarises what is needed', () => {
    expect(unavailableSummary(QEC)).toBe('Needs the QEC research pack (stim, pymatching)');
    expect(unavailableSummary({ ...QEC, kind: 'state_synthesis' })).toBe('Needs optional packages (stim, pymatching)');
  });

  it('prefers the kernel hint and falls back to catalog ids', () => {
    expect(unavailableInstructions(QEC)).toContain('Research catalog');
    const bare = { ...QEC, install: { catalog_ids: ['stim'], hint: '' } };
    expect(unavailableInstructions(bare)).toContain('stim');
    expect(unavailableStartMessage(QEC)).toMatch(/^Needs the QEC research pack \(stim, pymatching\)\. Install/);
  });

  it('finds an evaluator by kind', () => {
    expect(findEvaluator([TOY_EVALUATOR, QEC], 'qec_memory')).toBe(QEC);
    expect(findEvaluator([TOY_EVALUATOR], 'qec_memory')).toBeUndefined();
  });
});
