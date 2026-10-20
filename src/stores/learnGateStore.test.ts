import { describe, it, expect, beforeEach } from 'vitest';

// The "node" test environment has no localStorage; same in-memory stand-in as workspaceStore.test.ts.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? (this.store.get(key) as string) : null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

import {
  LEARN_ENABLED_KEY,
  applyLearnQueryParam,
  canEnterMode,
  effectiveWorkspaceMode,
  isLearnEnabled,
  learnParamRequested,
  useLearnGateStore,
} from './learnGateStore';
import { useWorkspaceStore, __notifyProjectRootChanged } from './workspaceStore';
import { useModeSwitchStore } from './modeSwitchStore';
import { useLearnStore } from './learnStore';
import { useChallengeModeStore } from './challengeModeStore';

const GLOBAL_KEY = 'nuclei:workspace_mode';
const PROJECT_KEY = 'nuclei:workspace_mode_by_project';

function resetAll(enabled: boolean) {
  localStorage.clear();
  __notifyProjectRootChanged(null);
  useLearnGateStore.getState().setLearnEnabled(enabled);
  useLearnStore.setState({ isLearnMode: false });
  useChallengeModeStore.setState({ isChallengeMode: false });
  useModeSwitchStore.setState({ pending: null, announcement: '' });
}

describe('pure gate helpers', () => {
  it('effectiveWorkspaceMode is research whenever the gate is off', () => {
    expect(effectiveWorkspaceMode('learn', false)).toBe('research');
    expect(effectiveWorkspaceMode('research', false)).toBe('research');
    expect(effectiveWorkspaceMode('learn', true)).toBe('learn');
    expect(effectiveWorkspaceMode('research', true)).toBe('research');
  });

  it('canEnterMode only refuses learn while gated', () => {
    expect(canEnterMode('learn', false)).toBe(false);
    expect(canEnterMode('learn', true)).toBe(true);
    expect(canEnterMode('research', false)).toBe(true);
  });

  it('learnParamRequested accepts a bare or truthy ?learn and rejects explicit off values', () => {
    expect(learnParamRequested('?learn')).toBe(true);
    expect(learnParamRequested('?learn=1')).toBe(true);
    expect(learnParamRequested('?a=b&learn=true')).toBe(true);
    expect(learnParamRequested('?learn=0')).toBe(false);
    expect(learnParamRequested('?learn=false')).toBe(false);
    expect(learnParamRequested('?learning=1')).toBe(false);
    expect(learnParamRequested('')).toBe(false);
  });
});

describe('the gate store', () => {
  beforeEach(() => resetAll(false));

  it('defaults to off', () => {
    expect(isLearnEnabled()).toBe(false);
  });

  it('persists the flag, and clears it when turned off', () => {
    useLearnGateStore.getState().setLearnEnabled(true);
    expect(localStorage.getItem(LEARN_ENABLED_KEY)).toBe('1');
    useLearnGateStore.getState().setLearnEnabled(false);
    expect(localStorage.getItem(LEARN_ENABLED_KEY)).toBeNull();
  });

  it('?learn turns it on (persisted) and never turns it off', () => {
    applyLearnQueryParam('?learn');
    expect(isLearnEnabled()).toBe(true);
    expect(localStorage.getItem(LEARN_ENABLED_KEY)).toBe('1');
    applyLearnQueryParam('?learn=0');
    expect(isLearnEnabled()).toBe(true);
  });

  it('a link without ?learn leaves it off', () => {
    applyLearnQueryParam('?foo=1');
    expect(isLearnEnabled()).toBe(false);
  });
});

describe('with the gate off', () => {
  beforeEach(() => resetAll(false));

  it('the mode is research even with Learn stored globally and per project', () => {
    localStorage.setItem(GLOBAL_KEY, 'learn');
    localStorage.setItem(PROJECT_KEY, JSON.stringify({ '/p': 'learn' }));
    __notifyProjectRootChanged(null);
    expect(useWorkspaceStore.getState().mode).toBe('research');
    __notifyProjectRootChanged('/p');
    expect(useWorkspaceStore.getState().mode).toBe('research');
  });

  it('a fresh install (nothing stored) is research', () => {
    __notifyProjectRootChanged(null);
    expect(useWorkspaceStore.getState().mode).toBe('research');
  });

  it('setMode("learn") is refused and writes nothing', () => {
    useWorkspaceStore.getState().setMode('learn');
    expect(useWorkspaceStore.getState().mode).toBe('research');
    expect(localStorage.getItem(GLOBAL_KEY)).toBeNull();
  });

  it('enterLearnMode and enterChallengeMode are no-ops', () => {
    useLearnStore.getState().enterLearnMode();
    useChallengeModeStore.getState().enterChallengeMode();
    expect(useLearnStore.getState().isLearnMode).toBe(false);
    expect(useChallengeModeStore.getState().isChallengeMode).toBe(false);
  });

  it('modeSwitchStore refuses to switch into learn, and toggling does nothing', () => {
    useModeSwitchStore.getState().requestSwitch('learn');
    expect(useWorkspaceStore.getState().mode).toBe('research');
    expect(useModeSwitchStore.getState().announcement).toBe('');
    useModeSwitchStore.getState().requestToggle();
    expect(useWorkspaceStore.getState().mode).toBe('research');
    expect(useModeSwitchStore.getState().announcement).toBe('');
  });
});

describe('flipping the gate', () => {
  beforeEach(() => resetAll(true));

  it('turning it on restores the stored Learn mode; stored values survive being off', () => {
    localStorage.setItem(GLOBAL_KEY, 'learn');
    __notifyProjectRootChanged(null);
    expect(useWorkspaceStore.getState().mode).toBe('learn');
    useLearnGateStore.getState().setLearnEnabled(false);
    expect(useWorkspaceStore.getState().mode).toBe('research');
    expect(localStorage.getItem(GLOBAL_KEY)).toBe('learn');
    useLearnGateStore.getState().setLearnEnabled(true);
    expect(useWorkspaceStore.getState().mode).toBe('learn');
  });

  it('turning it off while in Learn returns to research, closes the takeovers and announces', () => {
    useWorkspaceStore.getState().setMode('learn');
    useLearnStore.getState().enterLearnMode();
    expect(useLearnStore.getState().isLearnMode).toBe(true);
    useModeSwitchStore.getState().setLearnEnabled(false);
    expect(useWorkspaceStore.getState().mode).toBe('research');
    expect(useLearnStore.getState().isLearnMode).toBe(false);
    expect(useModeSwitchStore.getState().announcement).toBe('Switched to Research mode');
    expect(isLearnEnabled()).toBe(false);
  });

  it('turning it off while already in research just flips the flag', () => {
    useWorkspaceStore.getState().setMode('research');
    useModeSwitchStore.getState().setLearnEnabled(false);
    expect(useWorkspaceStore.getState().mode).toBe('research');
    expect(useModeSwitchStore.getState().announcement).toBe('');
  });

  it('with the gate on, setMode and requestSwitch reach learn as before', () => {
    useWorkspaceStore.getState().setMode('research');
    useModeSwitchStore.getState().requestSwitch('learn');
    expect(useWorkspaceStore.getState().mode).toBe('learn');
  });
});
