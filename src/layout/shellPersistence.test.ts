import { describe, it, expect } from 'vitest';
import { parseShell, shellStorageKey, sameShell, type PersistedShell } from './shellPersistence';

const VIEWS = ['files', 'experiments', 'settings'];

describe('parseShell', () => {
  it('accepts a well-formed record', () => {
    expect(parseShell({ activeView: 'experiments', diracOpen: false, diracWidth: 360, bottomCollapsed: true, bottomTab: 'terminal' }, VIEWS))
      .toEqual({ activeView: 'experiments', diracOpen: false, diracWidth: 360, bottomCollapsed: true, bottomTab: 'terminal' });
  });
  it('keeps an explicitly collapsed sidebar (null)', () => {
    expect(parseShell({ activeView: null }, VIEWS)).toEqual({ activeView: null });
  });
  it('drops a view the current mode does not offer', () => {
    expect(parseShell({ activeView: 'qec' }, VIEWS)).toEqual({});
  });
  it('drops wrongly-typed fields individually instead of rejecting everything', () => {
    expect(parseShell({ activeView: 3, diracOpen: 'yes', diracWidth: NaN, bottomCollapsed: true, bottomTab: 'x' }, VIEWS))
      .toEqual({ bottomCollapsed: true });
  });
  it('tolerates junk', () => {
    expect(parseShell(null, VIEWS)).toEqual({});
    expect(parseShell('nope', VIEWS)).toEqual({});
  });
});

describe('helpers', () => {
  it('keys per workspace mode so Learn and Research keep their own arrangement', () => {
    expect(shellStorageKey('learn')).not.toBe(shellStorageKey('research'));
  });
  it('sameShell compares every field', () => {
    const a: PersistedShell = { activeView: 'files', diracOpen: true, diracWidth: 320, bottomCollapsed: false, bottomTab: 'terminal' };
    expect(sameShell(a, { ...a })).toBe(true);
    expect(sameShell(a, { ...a, diracOpen: false })).toBe(false);
  });
});
