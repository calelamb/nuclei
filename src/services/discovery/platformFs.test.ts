import { describe, expect, it, vi } from 'vitest';
import type { PlatformBridge } from '../../platform/bridge';
import { createPlatformDiscoveryFs, platformJoin } from './platformFs';

function bridge(platform: 'desktop' | 'web', files: Record<string, string> = {}) {
  const store = { ...files };
  const b = {
    getPlatform: () => platform,
    saveFile: vi.fn(async (p: string, c: string) => { store[p] = c; }),
    deleteFile: vi.fn(async (p: string) => { delete store[p]; return true; }),
    createFile: vi.fn(async (p: string, c: string) => { store[p] = c; return { path: p }; }),
    createDirectory: vi.fn(async () => null),
    readFile: vi.fn(async (p: string) => store[p] ?? null),
    listDirectory: vi.fn(async (p: string) => {
      const prefix = `${p}/`;
      const names = new Set(Object.keys(store).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length).split('/')[0]));
      return names.size === 0 ? null : [...names].map((name) => ({ name, path: `${prefix}${name}`, kind: store[`${prefix}${name}`] !== undefined ? 'file' as const : 'directory' as const }));
    }),
  };
  return { b: b as unknown as PlatformBridge, store, raw: b };
}

describe('createPlatformDiscoveryFs', () => {
  it('overwrites with saveFile on desktop', async () => {
    const { b, store, raw } = bridge('desktop');
    await createPlatformDiscoveryFs(b).writeFile('a/run.json', 'x');
    expect(store['a/run.json']).toBe('x');
    expect(raw.deleteFile).not.toHaveBeenCalled();
  });

  it('overwrites with delete then create elsewhere (saveFile would download)', async () => {
    const { b, store, raw } = bridge('web', { 'a/run.json': 'old' });
    await createPlatformDiscoveryFs(b).writeFile('a/run.json', 'new');
    expect(store['a/run.json']).toBe('new');
    expect(raw.saveFile).not.toHaveBeenCalled();
  });

  it('surfaces a failed create as an error', async () => {
    const { b, raw } = bridge('web');
    raw.createFile.mockResolvedValueOnce(null as never);
    await expect(createPlatformDiscoveryFs(b).writeFile('a', 'x')).rejects.toThrow('could not create');
  });

  it('reads, lists and checks existence', async () => {
    const { b } = bridge('desktop', { 'p/a.json': '1', 'p/sub/b.json': '2' });
    const fs = createPlatformDiscoveryFs(b);
    expect(await fs.readFile('p/a.json')).toBe('1');
    expect(await fs.readFile('p/none')).toBeNull();
    expect((await fs.readDir('p')).sort((x, y) => x.name.localeCompare(y.name))).toEqual([{ name: 'a.json', isDirectory: false }, { name: 'sub', isDirectory: true }]);
    expect(await fs.readDir('missing')).toEqual([]);
    expect(await fs.exists('p')).toBe(true);
    expect(await fs.exists('p/a.json')).toBe(true);
    expect(await fs.exists('nope')).toBe(false);
    await fs.mkdir('p/new', { recursive: true });
  });

  it('joins paths', () => {
    expect(platformJoin('a/', '', '/b', 'c')).toBe('a/b/c');
  });
});
