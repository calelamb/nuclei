import type { PlatformBridge } from './bridge';

/**
 * WebBridge — browser-based implementation of PlatformBridge.
 *
 * Uses:
 * - localStorage for settings/preferences
 * - Browser File System Access API for file open/save
 * - document.title for window title
 * - Pyodide (loaded separately) for Python kernel
 */

// Storage helpers using localStorage
function storageGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`nuclei:${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: unknown): void {
  localStorage.setItem(`nuclei:${key}`, JSON.stringify(value));
}

export const webBridge: PlatformBridge = {
  async startKernel() {
    // Kernel is managed by the Pyodide WebSocket shim — no process to spawn
    return 'Web kernel ready (Pyodide)';
  },

  async stopKernel() {
    return 'Web kernel stopped';
  },

  async openFile() {
    // Use File System Access API if available, else fallback to <input>
    if ('showOpenFilePicker' in window) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: 'Python Files', accept: { 'text/x-python': ['.py'] } }],
          multiple: false,
        });
        const file = await handle.getFile();
        const content = await file.text();
        return { path: file.name, content };
      } catch {
        return null; // User cancelled
      }
    }

    // Fallback: hidden input element
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.py,.qasm';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        const content = await file.text();
        resolve({ path: file.name, content });
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  },

  async readFile() {
    return null;
  },

  async saveFile(_path: string, content: string) {
    // In web, saveFile always downloads
    downloadFile(_path, content);
  },

  async saveFileAs(content: string, defaultPath?: string) {
    if ('showSaveFilePicker' in window) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: defaultPath ?? 'untitled.py',
          types: [{ description: 'Python Files', accept: { 'text/x-python': ['.py'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return { path: handle.name };
      } catch {
        return null;
      }
    }

    // Fallback: download
    const name = defaultPath ?? 'untitled.py';
    downloadFile(name, content);
    return { path: name };
  },

  async renameFile(_oldPath: string, newName: string) {
    // In the web IDE files are ephemeral — there is no persistent disk to
    // rename on. Reflect the new name back so the editor updates its display
    // and subsequent Save As uses it as the default filename.
    if (!newName || newName.trim() === '') return null;
    return { path: newName.trim() };
  },

  async getStoredValue<T>(key: string): Promise<T | null> {
    return storageGet<T>(key);
  },

  async setStoredValue(key: string, value: unknown) {
    storageSet(key, value);
  },

  async setWindowTitle(title: string) {
    document.title = title;
  },

  getPlatform() {
    return 'web';
  },
};

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
