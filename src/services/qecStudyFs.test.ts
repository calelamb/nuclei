import { describe, expect, it, vi } from 'vitest';
import type { PlatformBridge } from '../platform/bridge';

const tauriFs = vi.hoisted(() => ({
  exists: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  watch: vi.fn(),
  writeTextFile: vi.fn(),
}));

const tauriPath = vi.hoisted(() => ({ resolve: vi.fn() }));
const tauriCore = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/plugin-fs', () => tauriFs);
vi.mock('@tauri-apps/api/path', () => tauriPath);
vi.mock('@tauri-apps/api/core', () => tauriCore);

import { createPlatformQecStudyFs, createTauriQecStudyFs } from './qecStudyFs';

function platformBridge(overrides: Partial<PlatformBridge> = {}): PlatformBridge {
  return {
    startKernel: vi.fn(), stopKernel: vi.fn(), openFile: vi.fn(), readFile: vi.fn(async () => null),
    saveFile: vi.fn(), saveFileAs: vi.fn(), renameFile: vi.fn(), getStoredValue: vi.fn(),
    setStoredValue: vi.fn(), setWindowTitle: vi.fn(), getPlatform: () => 'web',
    openDirectory: vi.fn(), listDirectory: vi.fn(async () => null), createFile: vi.fn(async () => null),
    createDirectory: vi.fn(async () => null), deleteFile: vi.fn(), ...overrides,
  };
}

describe('createTauriQecStudyFs', () => {
  it('adapts Tauri filesystem operations behind the QEC Study port', async () => {
    tauriFs.readTextFile.mockResolvedValue('study yaml');
    tauriCore.invoke.mockImplementation(async (command: string) => command === 'qec_read_study_manifests'
      ? [{ fileName: 'study.qec-study.yaml', content: 'study yaml', error: null }]
      : 'created');
    tauriFs.readDir.mockResolvedValue([{ name: 'studies', isDirectory: true, isSymlink: false }]);
    tauriFs.mkdir.mockResolvedValue(undefined);
    tauriFs.exists.mockResolvedValue(true);
    tauriFs.lstat.mockResolvedValue({ isSymlink: false });
    tauriPath.resolve.mockImplementation(async (...parts: string[]) => parts.join('/'));
    const unwatch = vi.fn();
    tauriFs.watch.mockImplementation(async (_path, callback) => {
      callback({ paths: ['/project/studies/change.qec-study.yaml'] });
      return unwatch;
    });
    const fs = createTauriQecStudyFs();
    const onEvent = vi.fn();

    await expect(fs.readTextFile('/project/study.yaml')).resolves.toBe('study yaml');
    await expect(fs.readStudyManifests?.('/project')).resolves.toEqual([
      { fileName: 'study.qec-study.yaml', content: 'study yaml', error: null },
    ]);
    await expect(fs.createTextFileExclusive('/project', 'study.qec-study.yaml', 'next')).resolves.toBeUndefined();
    await expect(fs.readDir('/project')).resolves.toEqual([{ name: 'studies', isDirectory: true, isSymlink: false }]);
    await expect(fs.mkdir('/project/studies', { recursive: true })).resolves.toBeUndefined();
    await expect(fs.exists('/project')).resolves.toBe(true);
    await expect(fs.isSymlink('/project/studies')).resolves.toBe(false);
    await expect(fs.resolvePath('/project', 'studies')).resolves.toBe('/project/studies');
    expect(fs.join('/project/', '/studies', 'surface.yaml')).toBe('/project/studies/surface.yaml');
    await expect(fs.watch('/project', onEvent, { recursive: false })).resolves.toBe(unwatch);

    expect(tauriFs.mkdir).toHaveBeenCalledWith('/project/studies', { recursive: true });
    expect(tauriCore.invoke).toHaveBeenCalledWith('qec_create_study_manifest', {
      projectRoot: '/project',
      fileName: 'study.qec-study.yaml',
      content: 'next',
    });
    expect(tauriFs.watch).toHaveBeenCalledWith('/project', expect.any(Function), { recursive: false });
    expect(onEvent).toHaveBeenCalledWith(['/project/studies/change.qec-study.yaml']);
  });

  it('does not misclassify a missing-parent write failure as an existing file', async () => {
    tauriCore.invoke.mockRejectedValueOnce(new Error('The parent directory does not exist'));
    await expect(createTauriQecStudyFs().createTextFileExclusive('/missing', 'study.qec-study.yaml', 'next'))
      .rejects.toThrow('The parent directory does not exist');
  });

  it('classifies an operating-system existing-file failure as an exclusive-create collision', async () => {
    tauriCore.invoke.mockResolvedValueOnce('exists');
    await expect(createTauriQecStudyFs().createTextFileExclusive('/project', 'study.qec-study.yaml', 'next'))
      .rejects.toMatchObject({ name: 'QecStudyFileExistsError' });
  });

  it('fails closed when existing-path symlink metadata cannot be read', async () => {
    tauriFs.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    tauriFs.lstat.mockRejectedValueOnce(new Error('metadata permission denied'));
    const fs = createTauriQecStudyFs();

    await expect(fs.isSymlink('/project/studies')).rejects.toThrow('metadata permission denied');
    await expect(fs.isSymlink('/project/missing')).resolves.toBe(false);
  });
});

describe('createPlatformQecStudyFs', () => {
  it('adapts the read-only web project bridge for fixture discovery', async () => {
    const unwatch = vi.fn();
    const bridge = platformBridge({
      readFile: vi.fn(async (path) => path.endsWith('.yaml') ? 'schema: 1' : null),
      listDirectory: vi.fn(async (path) => path.endsWith('studies') ? [{ name: 'study.yaml', path: `${path}/study.yaml`, kind: 'file' }] : null),
      createFileExclusive: vi.fn(async () => 'created'),
    });
    const fs = createPlatformQecStudyFs(bridge);

    await expect(fs.exists('/project/studies')).resolves.toBe(true);
    await expect(fs.readDir('/project/studies')).resolves.toEqual([{ name: 'study.yaml', isDirectory: false, isSymlink: false }]);
    await expect(fs.readTextFile('/project/studies/study.yaml')).resolves.toBe('schema: 1');
    await expect(fs.watch('/project/studies', unwatch)).resolves.toEqual(expect.any(Function));
  });

  it('rejects unavailable writes with an actionable error', async () => {
    const fs = createPlatformQecStudyFs(platformBridge());

    await expect(fs.createTextFileExclusive('/project', 'new.yaml', 'content')).rejects.toThrow('Writing is unavailable');
    await expect(fs.mkdir('/project/studies', { recursive: true })).rejects.toThrow('Creating a directory at is unavailable');
    await expect(fs.readTextFile('/missing.yaml')).rejects.toThrow('Reading is unavailable');
    await expect(fs.readDir('/missing')).rejects.toThrow('Listing is unavailable');
  });

  it('preserves an exclusive-create collision from a platform adapter', async () => {
    const fs = createPlatformQecStudyFs(platformBridge({
      createFileExclusive: vi.fn(async () => 'exists'),
    }));
    await expect(fs.createTextFileExclusive('/project', 'existing.yaml', 'next'))
      .rejects.toMatchObject({ name: 'QecStudyFileExistsError' });
  });
});
