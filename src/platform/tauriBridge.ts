import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, rename, exists, readDir, remove, mkdir } from '@tauri-apps/plugin-fs';
import { load } from '@tauri-apps/plugin-store';
import type { PlatformBridge } from './bridge';

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load('settings.json', { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export const tauriBridge: PlatformBridge = {
  async startKernel() {
    return await invoke<string>('start_kernel');
  },

  async stopKernel() {
    return await invoke<string>('stop_kernel');
  },

  async openFile() {
    const selected = await open({
      filters: [{ name: 'Python', extensions: ['py'] }],
      multiple: false,
    });
    if (!selected) return null;
    const path = typeof selected === 'string' ? selected : selected;
    const content = await readTextFile(path);
    return { path, content };
  },

  async readFile(path: string) {
    try {
      return await readTextFile(path);
    } catch {
      return null;
    }
  },

  async saveFile(path: string, content: string) {
    await writeTextFile(path, content);
  },

  async saveFileAs(content: string, defaultPath?: string) {
    const path = await save({
      filters: [{ name: 'Python', extensions: ['py'] }],
      defaultPath: defaultPath ?? 'untitled.py',
    });
    if (!path) return null;
    await writeTextFile(path, content);
    return { path };
  },

  async renameFile(oldPath: string, newName: string) {
    // Accept either a bare filename ("foo.py") or a full path. Bare names
    // rename in place; full paths allow moving to a different directory.
    // A null return means the caller should treat this as a no-op (user
    // cancelled, target collision, or the FS call failed).
    if (!newName || newName.trim() === '') return null;
    const trimmed = newName.trim();
    const isAbsolute = trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed);
    const sepIdx = Math.max(oldPath.lastIndexOf('/'), oldPath.lastIndexOf('\\'));
    const dir = sepIdx >= 0 ? oldPath.slice(0, sepIdx + 1) : '';
    const newPath = isAbsolute ? trimmed : dir + trimmed;
    if (newPath === oldPath) return { path: oldPath };
    try {
      // Refuse to clobber — surface rename collisions to the caller.
      if (await exists(newPath)) return null;
      await rename(oldPath, newPath);
      return { path: newPath };
    } catch {
      return null;
    }
  },

  async getStoredValue<T>(key: string): Promise<T | null> {
    try {
      const store = await getStore();
      return (await store.get<T>(key)) ?? null;
    } catch {
      return null;
    }
  },

  async setStoredValue(key: string, value: unknown) {
    const store = await getStore();
    await store.set(key, value);
  },

  async setWindowTitle(title: string) {
    await getCurrentWindow().setTitle(title);
  },

  getPlatform() {
    return 'desktop';
  },

  async openDirectory() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== 'string') return null;
      return { path: selected };
    } catch {
      return null;
    }
  },

  async listDirectory(path: string) {
    try {
      const entries = await readDir(path);
      return entries
        .filter((e) => {
          if (!e.name) return false;
          if (e.name.startsWith('.')) return false;
          if (e.name === 'node_modules' || e.name === '__pycache__' || e.name === 'dist' || e.name === 'target') return false;
          return true;
        })
        .map((e) => ({
          name: e.name ?? '',
          path: `${path}/${e.name}`,
          kind: e.isDirectory ? ('directory' as const) : ('file' as const),
        }))
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch {
      return null;
    }
  },

  async createFile(path: string, content: string) {
    try {
      if (await exists(path)) return null;
      await writeTextFile(path, content);
      return { path };
    } catch {
      return null;
    }
  },

  async createDirectory(path: string, recursive = false) {
    try {
      if (await exists(path)) return null;
      await mkdir(path, { recursive });
      return { path };
    } catch {
      return null;
    }
  },

  async deleteFile(path: string) {
    try {
      await remove(path);
      return true;
    } catch {
      return false;
    }
  },
};
