import { createContext, useContext } from 'react';
import type { PlatformBridge } from './bridge';

// Detect platform: if __TAURI_INTERNALS__ exists, we're in Tauri
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Lazy-load the correct bridge to avoid importing Tauri APIs in the browser
let defaultBridge: PlatformBridge | null = null;

async function loadBridge(): Promise<PlatformBridge> {
  if (defaultBridge) return defaultBridge;
  if (isTauri) {
    const { tauriBridge } = await import('./tauriBridge');
    defaultBridge = tauriBridge;
  } else {
    const { webBridge } = await import('./webBridge');
    defaultBridge = webBridge;
  }
  return defaultBridge;
}

const fallbackBridge: PlatformBridge = {
  async startKernel() {
    return 'Kernel unavailable';
  },
  async stopKernel() {
    return 'Kernel unavailable';
  },
  async openFile() {
    return null;
  },
  async readFile() {
    return null;
  },
  async saveFile() {},
  async saveFileAs() {
    return null;
  },
  async renameFile() {
    return null;
  },
  async getStoredValue() {
    return null;
  },
  async setStoredValue() {},
  async setWindowTitle() {},
  getPlatform() {
    return 'web';
  },
  async openDirectory() {
    return null;
  },
  async listDirectory() {
    return null;
  },
  async createFile() {
    return null;
  },
  async createDirectory() {
    return null;
  },
  async deleteFile() {
    return false;
  },
};

function getSyncBridge(): PlatformBridge {
  if (defaultBridge) return defaultBridge;
  return fallbackBridge;
}

const PlatformContext = createContext<PlatformBridge>(getSyncBridge());

export function PlatformProvider({ children, bridge }: { children: React.ReactNode; bridge?: PlatformBridge }) {
  return (
    <PlatformContext.Provider value={bridge ?? getSyncBridge()}>
      {children}
    </PlatformContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePlatform(): PlatformBridge {
  return useContext(PlatformContext);
}

// eslint-disable-next-line react-refresh/only-export-components
export { isTauri, loadBridge };
