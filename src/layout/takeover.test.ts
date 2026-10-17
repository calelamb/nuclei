import { describe, expect, it } from 'vitest';
import { isMainAreaTakeover, type TakeoverFacts } from './takeover';

const base: TakeoverFacts = { isLearnMode: false, isChallengeMode: false, workspaceMode: 'research', activeView: 'files', experimentSelected: false };

describe('isMainAreaTakeover', () => {
  it('is false in the plain editor', () => expect(isMainAreaTakeover(base)).toBe(false));
  it('is true for a lesson or a challenge', () => {
    expect(isMainAreaTakeover({ ...base, workspaceMode: 'learn', isLearnMode: true })).toBe(true);
    expect(isMainAreaTakeover({ ...base, workspaceMode: 'learn', isChallengeMode: true })).toBe(true);
  });
  it('is true for the QEC Workbench and the transpiler in Research', () => {
    expect(isMainAreaTakeover({ ...base, activeView: 'qec' })).toBe(true);
    expect(isMainAreaTakeover({ ...base, activeView: 'transpiler' })).toBe(true);
  });
  it('experiments only take over once one is selected', () => {
    expect(isMainAreaTakeover({ ...base, activeView: 'experiments' })).toBe(false);
    expect(isMainAreaTakeover({ ...base, activeView: 'experiments', experimentSelected: true })).toBe(true);
  });
  it('the Research-only views never take over in Learn', () => {
    expect(isMainAreaTakeover({ ...base, workspaceMode: 'learn', activeView: 'qec' })).toBe(false);
  });
});
