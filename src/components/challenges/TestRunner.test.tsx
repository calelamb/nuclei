// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

vi.mock('./ChallengeInspector', () => ({ ChallengeInspector: () => <div>inspector</div> }));
vi.mock('../../platform/PlatformProvider', () => ({ usePlatform: () => ({ isDesktop: true }) }));

import { TestRunner } from './TestRunner';

const CHALLENGE = {
  id: 'c1', title: 'T', testCases: [{ id: 't1', label: 'Case 1', weight: 1, hidden: false }],
  starterCode: { qiskit: '' },
} as never;

afterEach(cleanup);

describe('TestRunner result tabs', () => {
  it('links tabs to a tabpanel and switches with the arrow keys', () => {
    render(<TestRunner challenge={CHALLENGE} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1']);
    const panel = screen.getByRole('tabpanel');
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id);

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getAllByRole('tab')[1]);
    expect(screen.getByText('inspector')).toBeTruthy();
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getAllByRole('tab')[1].id);
  });
});
