// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CommandPalette, type Command } from './CommandPalette';

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const mk = (id: string, label: string, action = vi.fn()): Command => ({ id, label, category: 'View', action });

describe('CommandPalette interactions', () => {
  it('moves the selection when the pointer moves over another row', () => {
    render(<CommandPalette commands={[mk('a', 'Alpha'), mk('b', 'Beta'), mk('c', 'Gamma')]} onClose={vi.fn()} />);
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.mouseMove(options[2]);
    expect(screen.getAllByRole('option')[2].getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('false');
  });

  it('points aria-activedescendant at the selected option', () => {
    render(<CommandPalette commands={[mk('a', 'Alpha'), mk('b', 'Beta')]} onClose={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const active = input.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active as string)?.textContent).toContain('Beta');
  });

  it('restores focus to the previously focused element when it closes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<CommandPalette commands={[mk('a', 'Alpha')]} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('does not list a category word in front of every label twice (no "Go · Go to")', () => {
    render(<CommandPalette commands={[{ id: 'g', label: 'Go to Settings', category: 'Navigate', action: vi.fn() }]} onClose={vi.fn()} />);
    expect(screen.getByRole('option').textContent).not.toMatch(/^Go\s*Go to/);
  });

  it('Enter runs the highlighted command after closing', () => {
    const action = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette commands={[mk('a', 'Alpha', action)]} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onClose).toHaveBeenCalled();
  });
});
