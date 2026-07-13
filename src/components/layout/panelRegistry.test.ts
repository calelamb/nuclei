import { describe, it, expect } from 'vitest';
import { activityViewsForMode, bottomViewsForMode } from './panelRegistry';

// PRD 11 Phase C — the activity rail is now registry-driven with a single
// gating axis per view. The developer flag (formerly "experimental features")
// governs ONLY Search + Circuit; every other view is chosen by mode alone.

describe('activityViewsForMode (registry-driven, Phase C)', () => {
  it('Learn mode, developer views OFF — files/learning/challenges/launch/community + settings', () => {
    expect(activityViewsForMode('learn', { experimentalFeatures: false })).toEqual([
      'files',
      'learning',
      'challenges',
      'launch',
      'community',
      'settings',
    ]);
  });

  it('Learn mode, developer views ON — adds ONLY search + circuit (not plugins/hardware)', () => {
    expect(activityViewsForMode('learn', { experimentalFeatures: true })).toEqual([
      'files',
      'learning',
      'challenges',
      'launch',
      'community',
      'search',
      'circuit',
      'settings',
    ]);
  });

  it('Research mode, developer views OFF — files/experiments/hardware/launch/plugins + settings', () => {
    expect(activityViewsForMode('research', { experimentalFeatures: false })).toEqual([
      'files',
      'experiments',
      'hardware',
      'launch',
      'plugins',
      'settings',
    ]);
  });

  it('Research mode, developer views ON — adds search + circuit', () => {
    expect(activityViewsForMode('research', { experimentalFeatures: true })).toEqual([
      'files',
      'experiments',
      'hardware',
      'launch',
      'plugins',
      'search',
      'circuit',
      'settings',
    ]);
  });

  it('hardware and plugins are Research-only; learning/challenges/community are Learn-only', () => {
    const research = activityViewsForMode('research', { experimentalFeatures: true });
    const learn = activityViewsForMode('learn', { experimentalFeatures: true });
    expect(research).toContain('hardware');
    expect(research).toContain('plugins');
    expect(research).not.toContain('learning');
    expect(research).not.toContain('challenges');
    expect(research).not.toContain('community');
    expect(learn).not.toContain('hardware');
    expect(learn).not.toContain('plugins');
    expect(learn).not.toContain('experiments');
  });

  it('developer views is the ONLY flag-gated dimension — search/circuit toggle, nothing else', () => {
    for (const mode of ['learn', 'research'] as const) {
      const off = activityViewsForMode(mode, { experimentalFeatures: false });
      const on = activityViewsForMode(mode, { experimentalFeatures: true });
      const added = on.filter((v) => !off.includes(v));
      expect(added.sort()).toEqual(['circuit', 'search']);
    }
  });
});

describe('bottomViewsForMode', () => {
  it('pins settings to the bottom in both modes', () => {
    expect(bottomViewsForMode('learn')).toEqual(['settings']);
    expect(bottomViewsForMode('research')).toEqual(['settings']);
  });
});
