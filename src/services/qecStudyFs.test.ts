import { describe, expect, it, vi } from 'vitest';

const tauriFs = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  watch: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => tauriFs);

import { createTauriQecStudyFs } from './qecStudyFs';

describe('createTauriQecStudyFs', () => {
  it('adapts Tauri filesystem operations behind the QEC Study port', async () => {
    tauriFs.readTextFile.mockResolvedValue('study yaml');
    tauriFs.writeTextFile.mockResolvedValue(undefined);
    tauriFs.readDir.mockResolvedValue([{ name: 'studies', isDirectory: true }]);
    tauriFs.mkdir.mockResolvedValue(undefined);
    tauriFs.exists.mockResolvedValue(true);
    const unwatch = vi.fn();
    tauriFs.watch.mockImplementation(async (_path, callback) => {
      callback();
      return unwatch;
    });
    const fs = createTauriQecStudyFs();
    const onEvent = vi.fn();

    await expect(fs.readTextFile('/project/study.yaml')).resolves.toBe('study yaml');
    await expect(fs.writeTextFile('/project/study.yaml', 'next')).resolves.toBeUndefined();
    await expect(fs.readDir('/project')).resolves.toEqual([{ name: 'studies', isDirectory: true }]);
    await expect(fs.mkdir('/project/studies', { recursive: true })).resolves.toBeUndefined();
    await expect(fs.exists('/project')).resolves.toBe(true);
    expect(fs.join('/project/', '/studies', 'surface.yaml')).toBe('/project/studies/surface.yaml');
    await expect(fs.watch('/project', onEvent, { recursive: false })).resolves.toBe(unwatch);

    expect(tauriFs.mkdir).toHaveBeenCalledWith('/project/studies', { recursive: true });
    expect(tauriFs.watch).toHaveBeenCalledWith('/project', expect.any(Function), { recursive: false });
    expect(onEvent).toHaveBeenCalledOnce();
  });
});
