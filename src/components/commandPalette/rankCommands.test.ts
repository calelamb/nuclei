import { describe, it, expect } from 'vitest';
import { rankCommands } from './rankCommands';
import type { Command } from './CommandPalette';

const noop = () => {};
const cmd = (id: string, label: string, category = 'View', keywords?: string[]): Command =>
  ({ id, label, category, keywords, action: noop });

const COMMANDS: Command[] = [
  cmd('workspace-mode', 'Switch workspace mode (Learn/Research)', 'Navigate'),
  cmd('toggle-panel-circuit', 'Toggle Circuit panel'),
  cmd('run', 'Run Circuit', 'Run'),
  cmd('theme', 'Toggle Theme', 'View', ['dark', 'light', 'appearance']),
  cmd('goto-settings', 'Go to Settings', 'Navigate'),
  cmd('shortcuts', 'Keyboard Shortcuts', 'Help'),
];

describe('rankCommands', () => {
  it('returns everything in original order for an empty query', () => {
    expect(rankCommands(COMMANDS, '  ').map((c) => c.id)).toEqual(COMMANDS.map((c) => c.id));
  });

  it('puts the obvious match first: "run" ranks Run Circuit above Toggle Circuit panel', () => {
    const ids = rankCommands(COMMANDS, 'run').map((c) => c.id);
    expect(ids[0]).toBe('run');
  });

  it('"theme" ranks Toggle Theme first, not Switch workspace mode', () => {
    expect(rankCommands(COMMANDS, 'theme')[0].id).toBe('theme');
  });

  it('matches synonyms through keywords ("dark" finds Toggle Theme)', () => {
    const ids = rankCommands(COMMANDS, 'dark').map((c) => c.id);
    expect(ids).toEqual(['theme']);
  });

  it('prefers a word-start match over a mid-word substring', () => {
    const list = [cmd('a', 'Restart kernel'), cmd('b', 'Start fresh')];
    expect(rankCommands(list, 'start')[0].id).toBe('b');
  });

  it('requires every word of a multi-word query to match', () => {
    const ids = rankCommands(COMMANDS, 'toggle theme').map((c) => c.id);
    expect(ids[0]).toBe('theme');
    expect(ids).not.toContain('run');
  });

  it('drops commands that do not match at all', () => {
    expect(rankCommands(COMMANDS, 'zzzz')).toEqual([]);
  });

  it('is stable: equal scores keep their registry order', () => {
    const list = [cmd('a', 'Open one'), cmd('b', 'Open two')];
    expect(rankCommands(list, 'open').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('does not match scattered letters: "theme" is not "Switch workspace mode"', () => {
    const ids = rankCommands(COMMANDS, 'theme').map((c) => c.id);
    expect(ids).toEqual(['theme']);
  });

  it('"terminal" finds the terminal, not every command whose letters happen to contain it', () => {
    const list = [
      cmd('hist', 'Toggle Histogram tab'),
      cmd('term', 'Toggle terminal panel'),
      cmd('est', 'Go to Resource Estimator', 'Navigate'),
    ];
    expect(rankCommands(list, 'terminal').map((c) => c.id)).toEqual(['term']);
  });

  it('"sett" lists Settings and nothing that merely contains s, e, t, t in order', () => {
    const list = [cmd('est', 'Go to Resource Estimator', 'Navigate'), cmd('step', 'Step through circuit', 'Circuit'), cmd('set', 'Go to Settings', 'Navigate')];
    expect(rankCommands(list, 'sett').map((c) => c.id)).toEqual(['set']);
  });

  it('still finds a command by the initials of its words ("tdp")', () => {
    const list = [cmd('dirac', 'Toggle Dirac panel', 'Dirac'), cmd('theme', 'Toggle theme')];
    expect(rankCommands(list, 'tdp').map((c) => c.id)).toEqual(['dirac']);
  });
});
