import { describe, it, expect } from 'vitest';
import { featuresForUiMode, featuresFor } from './uiModeFeatures';

describe('progressive disclosure', () => {
  it('Beginner hides hardware launch, the agent, layout presets, the Explorer and the framework picker', () => {
    expect(featuresForUiMode('beginner')).toEqual({
      launchHardware: false,
      agentEntry: false,
      layoutPresets: false,
      explorerSidebar: false,
      frameworkPicker: false,
    });
  });

  it('Intermediate adds the Explorer, framework picker, presets and hardware but not the agent', () => {
    expect(featuresForUiMode('intermediate')).toEqual({
      launchHardware: true,
      agentEntry: false,
      layoutPresets: true,
      explorerSidebar: true,
      frameworkPicker: true,
    });
  });

  it('Advanced shows everything', () => {
    expect(Object.values(featuresForUiMode('advanced')).every(Boolean)).toBe(true);
  });

  it('is strictly additive from beginner to advanced', () => {
    const order = ['beginner', 'intermediate', 'advanced'] as const;
    for (let i = 1; i < order.length; i++) {
      const lo = featuresForUiMode(order[i - 1]);
      const hi = featuresForUiMode(order[i]);
      for (const k of Object.keys(lo) as Array<keyof typeof lo>) {
        if (lo[k]) expect(hi[k]).toBe(true);
      }
    }
  });

  it('Research ignores the UI mode entirely and is always advanced', () => {
    expect(featuresFor('research', 'beginner')).toEqual(featuresForUiMode('advanced'));
    expect(featuresFor('learn', 'beginner')).toEqual(featuresForUiMode('beginner'));
  });
});
