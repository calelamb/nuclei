// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ActivityBar } from './ActivityBar';
import { activityViewsForMode } from './panelRegistry';

afterEach(() => cleanup());

describe('<ActivityBar>', () => {
  it('renders exactly the Learn-mode items, in order, as a toolbar', () => {
    const views = activityViewsForMode('learn', { experimentalFeatures: false });
    const { getByRole } = render(
      <ActivityBar active="files" onSelect={vi.fn()} visibleViews={views} workspaceMode="learn" />,
    );
    const toolbar = getByRole('toolbar', { name: 'Activity bar' });
    const labels = Array.from(toolbar.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    // PRD 11 Phase C: Community graduated into the Learn rail.
    expect(labels).toEqual(['Explorer', 'Learning', 'Challenges', 'Launch', 'Community', 'Settings']);
  });

  it('renders Research-mode items (Experiments, Hardware, Plugins), without Learning/Challenges/Community', () => {
    const views = activityViewsForMode('research', { experimentalFeatures: false });
    const { getByRole } = render(
      <ActivityBar active="files" onSelect={vi.fn()} visibleViews={views} workspaceMode="research" />,
    );
    const toolbar = getByRole('toolbar', { name: 'Activity bar' });
    const labels = Array.from(toolbar.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    // Plugins graduated into the Research rail (Phase C).
    expect(labels).toEqual(['Explorer', 'Experiments', 'Hardware', 'Launch', 'Plugins', 'Settings']);
    expect(labels).not.toContain('Learning');
    expect(labels).not.toContain('Challenges');
    expect(labels).not.toContain('Community');
  });

  it('marks the active view pressed via aria-pressed', () => {
    const views = activityViewsForMode('learn', { experimentalFeatures: false });
    const { getByLabelText } = render(
      <ActivityBar active="learning" onSelect={vi.fn()} visibleViews={views} workspaceMode="learn" />,
    );
    expect(getByLabelText('Learning').getAttribute('aria-pressed')).toBe('true');
    expect(getByLabelText('Explorer').getAttribute('aria-pressed')).toBe('false');
  });
});
