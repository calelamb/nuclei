import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
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
};
