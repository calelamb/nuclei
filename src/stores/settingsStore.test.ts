import { describe, it, expect, beforeEach } from 'vitest';

// The vitest "node" environment (see vitest.config.ts) has no browser
// localStorage global. settingsStore reads/writes it directly (guarded by
// try/catch for restricted environments), so tests that exercise
// persistence need a minimal in-memory stand-in.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

import { useSettingsStore } from './settingsStore';

const DEFAULT_AGENT_HARDWARE = {
  autonomousHardwareEnabled: false,
  allowQpu: false,
  maxSpend: 0,
  maxShots: 4096,
  providerAllowlist: [] as string[],
};

describe('settingsStore — agentHardware', () => {
  beforeEach(() => {
    localStorage.removeItem('nuclei-settings');
    useSettingsStore.getState().resetAll();
  });

  it('defaults to autonomous hardware submission OFF (safety default)', () => {
    const { agentHardware } = useSettingsStore.getState();
    expect(agentHardware).toEqual(DEFAULT_AGENT_HARDWARE);
    expect(agentHardware.autonomousHardwareEnabled).toBe(false);
  });

  it('updateAgentHardware patches only the given fields', () => {
    useSettingsStore.getState().updateAgentHardware({ maxSpend: 25 });
    const { agentHardware } = useSettingsStore.getState();
    expect(agentHardware.maxSpend).toBe(25);
    expect(agentHardware.autonomousHardwareEnabled).toBe(false);
    expect(agentHardware.allowQpu).toBe(false);
  });

  it('can be explicitly enabled by a setter call', () => {
    useSettingsStore.getState().updateAgentHardware({
      autonomousHardwareEnabled: true,
      allowQpu: true,
      maxSpend: 10,
      providerAllowlist: ['ibm'],
    });
    const { agentHardware } = useSettingsStore.getState();
    expect(agentHardware.autonomousHardwareEnabled).toBe(true);
    expect(agentHardware.allowQpu).toBe(true);
    expect(agentHardware.maxSpend).toBe(10);
    expect(agentHardware.providerAllowlist).toEqual(['ibm']);
  });

  it('persists agentHardware to localStorage and rehydrates it back', () => {
    useSettingsStore.getState().updateAgentHardware({ maxSpend: 42, maxShots: 2048 });

    const raw = localStorage.getItem('nuclei-settings');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.agentHardware).toEqual({
      autonomousHardwareEnabled: false,
      allowQpu: false,
      maxSpend: 42,
      maxShots: 2048,
      providerAllowlist: [],
    });
  });

  it('resetAll restores the SAFE default', () => {
    useSettingsStore.getState().updateAgentHardware({ autonomousHardwareEnabled: true, maxSpend: 100 });
    useSettingsStore.getState().resetAll();
    expect(useSettingsStore.getState().agentHardware).toEqual(DEFAULT_AGENT_HARDWARE);
  });
});
