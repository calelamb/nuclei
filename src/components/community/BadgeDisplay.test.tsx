// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BadgeDisplay } from './BadgeDisplay';
import { BADGES } from '../../data/community/badges';

afterEach(cleanup);

describe('BadgeDisplay', () => {
  it('flows badges into as many 96px+ columns as fit, so a 240px rail never clips or splits words', () => {
    const { container } = render(<BadgeDisplay earnedBadgeIds={[]} />);
    expect((container.firstElementChild as HTMLElement).style.gridTemplateColumns).toBe('repeat(auto-fill, minmax(96px, 1fr))');
  });

  it('shows locked badges at full opacity with a lock state in the accessible name', () => {
    const first = BADGES[0];
    render(<BadgeDisplay earnedBadgeIds={[]} />);
    const tile = screen.getByRole('group', { name: new RegExp(`${first.name} \\(locked\\)`) });
    expect(tile.style.opacity).toBe('');
  });

  it('does not mark earned badges as locked', () => {
    const first = BADGES[0];
    render(<BadgeDisplay earnedBadgeIds={[first.id]} />);
    expect(screen.getByRole('group', { name: new RegExp(`^${first.name}:`) })).toBeTruthy();
  });
});
