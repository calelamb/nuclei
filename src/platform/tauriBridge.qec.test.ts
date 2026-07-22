import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTitle: vi.fn(async () => undefined) }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(), writeTextFile: vi.fn(), rename: vi.fn(), exists: vi.fn(),
  readDir: vi.fn(), remove: vi.fn(), mkdir: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })),
}));

import { tauriBridge } from './tauriBridge';

describe('tauriBridge QEC Data Engine lifecycle', () => {
  beforeEach(() => tauri.invoke.mockReset());

  it('forwards project-scoped start and explicit stop through Tauri invoke', async () => {
    const endpoint = { url: 'ws://127.0.0.1:9743', token: 'test-token' };
    tauri.invoke.mockResolvedValueOnce(endpoint).mockResolvedValueOnce(undefined);

    await expect(tauriBridge.startQecDataEngine('/projects/alpha')).resolves.toEqual(endpoint);
    await expect(tauriBridge.stopQecDataEngine()).resolves.toBeUndefined();

    expect(tauri.invoke.mock.calls).toEqual([
      ['qec_data_start', { projectRoot: '/projects/alpha' }],
      ['qec_data_stop'],
    ]);
  });
});
