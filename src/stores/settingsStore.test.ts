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

describe('settingsStore — rendered General rows have consumers', () => {
  it('every general.* key shown in SettingsPanel is read somewhere outside the store and panel', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.(tsx?)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
    });
    const src = join(process.cwd(), 'src');
    const panel = readFileSync(join(src, 'components/settings/SettingsPanel.tsx'), 'utf8');
    const rendered = Array.from(panel.matchAll(/general\.(\w+)/g)).map((m) => m[1]);
    const others = walk(src)
      .filter((p) => !/settingsStore\.ts$|SettingsPanel\.tsx$|motionPreference\.ts$/.test(p))
      .map((p) => readFileSync(p, 'utf8'))
      .join('\n');
    // animationsEnabled is consumed inside the store itself (applyMotionPreference), covered by its own test.
    const dead = [...new Set(rendered)]
      .filter((k) => k !== 'animationsEnabled')
      .filter((k) => !new RegExp(`\\b${k}\\b`).test(others));
    expect(dead).toEqual([]);
    expect(readFileSync(join(src, 'stores/settingsStore.ts'), 'utf8')).toContain('applyMotionPreference(get().general.animationsEnabled)');
  });
});
