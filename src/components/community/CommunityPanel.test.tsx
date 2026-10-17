// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { CommunityPanel } from './CommunityPanel';

afterEach(cleanup);

describe('CommunityPanel (LR-17)', () => {
  it('uses the Tabs primitive with arrow-key navigation', () => {
    render(<CommunityPanel />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Gallery', 'Challenges', 'Profile']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Challenges' }).getAttribute('aria-selected')).toBe('true');
  });

  it('renders gallery category filters as pressed chips, not filled pills', () => {
    render(<CommunityPanel />);
    const group = screen.getByRole('group', { name: 'Filter by category' });
    const all = group.querySelector('button[aria-pressed="true"]');
    expect(all?.textContent).toBe('All');
    expect(all?.className).toContain('nuclei-chip');
    fireEvent.click(screen.getByRole('button', { name: 'Tutorials' }));
    expect(screen.getByRole('button', { name: 'Tutorials' }).getAttribute('aria-pressed')).toBe('true');
    expect(all?.getAttribute('aria-pressed')).toBe('false');
  });
});
