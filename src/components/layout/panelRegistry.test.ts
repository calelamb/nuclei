import { describe, it, expect } from 'vitest';
import { activityViewsForMode, bottomViewsForMode } from './panelRegistry';

describe('activityViewsForMode', () => {
  it('Learn mode, experimentalFeatures off — the exact current rail set/order (snapshot)', () => {
    expect(activityViewsForMode('learn', { experimentalFeatures: false })).toEqual([
      'files',
      'learning',
      'challenges',
      'launch',
      'settings',
    ]);
  });

  it('Learn mode, experimentalFeatures on — the exact current rail set/order (snapshot)', () => {
    expect(activityViewsForMode('learn', { experimentalFeatures: true })).toEqual([
      'files',
      'learning',
      'challenges',
      'launch',
      'search',
      'circuit',
      'plugins',
      'hardware',
      'community',
      'settings',
    ]);
  });

  it('Research mode hides learning, challenges, and community', () => {
    const views = activityViewsForMode('research', { experimentalFeatures: false });
    expect(views).not.toContain('learning');
    expect(views).not.toContain('challenges');
    expect(views).not.toContain('community');
  });

  it('Research mode shows files, experiments, hardware, launch, settings', () => {
    expect(activityViewsForMode('research', { experimentalFeatures: false })).toEqual([
      'files',
      'experiments',
      'hardware',
      'launch',
      'settings',
    ]);
  });

  it('Research mode item set does not depend on experimentalFeatures', () => {
    expect(activityViewsForMode('research', { experimentalFeatures: false })).toEqual(
      activityViewsForMode('research', { experimentalFeatures: true }),
    );
  });
});

describe('bottomViewsForMode', () => {
  it('pins settings to the bottom in both modes', () => {
    expect(bottomViewsForMode('learn')).toEqual(['settings']);
    expect(bottomViewsForMode('research')).toEqual(['settings']);
  });
});
