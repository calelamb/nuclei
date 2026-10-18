// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { CommunityPanel } from './CommunityPanel';
import { ChallengeBoard } from './ChallengeBoard';
import { useCommunityStore } from '../../stores/communityStore';
import { useChallengeStore } from '../../stores/challengeStore';
import { MOCK_CHALLENGES } from '../../data/community/mockChallenges';
import type { GalleryCircuit } from '../../data/community/mockGallery';

const CIRCUIT: GalleryCircuit = {
  id: 'c1', title: 'Bell pair', description: 'Two entangled qubits', author: { id: 'u1', displayName: 'Ada' },
  framework: 'qiskit', code: 'qc.h(0)', category: 'tutorial', tags: [], likes: 1, createdAt: '2026-01-01T00:00:00Z', featured: false,
};

afterEach(() => {
  cleanup();
  useCommunityStore.setState({ circuits: [], selectedCategory: null });
  useChallengeStore.setState({ challenges: [], activeChallenge: null });
});

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
    useCommunityStore.setState({ circuits: [CIRCUIT] });
    render(<CommunityPanel />);
    const group = screen.getByRole('group', { name: 'Filter by category' });
    const all = group.querySelector('button[aria-pressed="true"]');
    expect(all?.textContent).toBe('All');
    expect(all?.className).toContain('nuclei-chip');
    fireEvent.click(screen.getByRole('button', { name: 'Tutorials' }));
    expect(screen.getByRole('button', { name: 'Tutorials' }).getAttribute('aria-pressed')).toBe('true');
    expect(all?.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not offer filters, search or sort over an empty gallery', () => {
    render(<CommunityPanel />);
    expect(screen.getByText('No shared circuits yet')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Filter by category' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Sort circuits' })).toBeNull();
    expect(screen.queryByPlaceholderText(/Search circuits/)).toBeNull();
  });
});

describe('ChallengeBoard with mock challenges', () => {
  it('never shows an invented submission count', () => {
    useChallengeStore.setState({ challenges: MOCK_CHALLENGES, activeChallenge: null });
    render(<ChallengeBoard />);
    expect(screen.queryByText(/submission/i, { selector: 'span' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d+ submissions?/);
  });

  it('offers an ended week as practice with a secondary button', () => {
    const ended = { ...MOCK_CHALLENGES[0], deadline: '2020-01-01T00:00:00Z' };
    useChallengeStore.setState({ challenges: [ended], activeChallenge: null });
    render(<ChallengeBoard />);
    expect(screen.queryByRole('button', { name: 'Start challenge' })).toBeNull();
    const practice = screen.getByRole('button', { name: 'Practice this challenge' });
    expect(practice.className).toContain('secondary');
  });

  it('keeps Start challenge as the primary action while a week is open', () => {
    const open = { ...MOCK_CHALLENGES[0], deadline: '2999-01-01T00:00:00Z' };
    useChallengeStore.setState({ challenges: [open], activeChallenge: null });
    render(<ChallengeBoard />);
    expect(screen.getByRole('button', { name: 'Start challenge' }).className).toContain('primary');
  });
});
