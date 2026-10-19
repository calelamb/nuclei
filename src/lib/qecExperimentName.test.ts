import { describe, it, expect } from 'vitest';
import { displayExperiment, experimentNames } from './qecExperimentName';

describe('experiment names (qec-r-80)', () => {
  it('spells out rounds and drops the default label', () => {
    expect(displayExperiment('stats r=3d')).toBe('rounds = 3d');
    expect(displayExperiment('stats')).toBe('default');
  });
  it('drops a prefix shared by every label', () => {
    const names = experimentNames(['synth r=3d', 'synth r=d']);
    expect(names.get('synth r=3d')).toBe('rounds = 3d');
    expect(names.get('synth r=d')).toBe('rounds = d');
  });
  it('keeps names that do not share a prefix', () => {
    expect(experimentNames(['alpha r=d', 'beta r=d']).get('alpha r=d')).toBe('alpha rounds = d');
  });
});
