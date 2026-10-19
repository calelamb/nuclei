import { describe, expect, it } from 'vitest';
import { isMainAreaTakeover, mainTakeoverKind, isSidebarShown, type SidebarFacts, type TakeoverFacts } from './takeover';

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

describe('isSidebarShown', () => {
  const side: SidebarFacts = { fullViewOwnsArea: false, activeView: 'qec', explorerSidebar: true, isWeb: false };
  it('shows the QEC study sidebar on desktop', () => expect(isSidebarShown(side)).toBe(true));
  it('drops the one-sentence QEC sidebar on the web so the analysis view gets the width', () => {
    expect(isSidebarShown({ ...side, isWeb: true })).toBe(false);
    expect(isSidebarShown({ ...side, isWeb: true, activeView: 'files' })).toBe(true);
  });
  it('drops the one-sentence Transpiler sidebar on the web too, keeping it on desktop', () => {
    expect(isSidebarShown({ ...side, activeView: 'transpiler', isWeb: true })).toBe(false);
    expect(isSidebarShown({ ...side, activeView: 'transpiler', isWeb: false })).toBe(true);
  });
  it('hides the Explorer at Beginner and everything under a lesson or with no view', () => {
    expect(isSidebarShown({ ...side, activeView: 'files', explorerSidebar: false })).toBe(false);
    expect(isSidebarShown({ ...side, fullViewOwnsArea: true })).toBe(false);
    expect(isSidebarShown({ ...side, activeView: null })).toBe(false);
  });
});

describe('mainTakeoverKind', () => {
  it('names the view that owns the main area', () => {
    expect(mainTakeoverKind(base)).toBeNull();
    expect(mainTakeoverKind({ ...base, workspaceMode: 'learn', isLearnMode: true })).toBe('lesson');
    expect(mainTakeoverKind({ ...base, workspaceMode: 'learn', isChallengeMode: true })).toBe('challenge');
    expect(mainTakeoverKind({ ...base, activeView: 'qec' })).toBe('qec');
    expect(mainTakeoverKind({ ...base, activeView: 'transpiler' })).toBe('transpiler');
    expect(mainTakeoverKind({ ...base, activeView: 'experiments', experimentSelected: true })).toBe('experiment');
  });
});
