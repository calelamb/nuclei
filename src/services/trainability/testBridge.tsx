import type { ReactNode } from 'react';
import { PlatformProvider } from '../../platform/PlatformProvider';
import type { PlatformBridge } from '../../platform/bridge';

/** Minimal bridge for render tests: only `getPlatform` is meaningful. */
export function testBridge(platform: 'desktop' | 'web', overrides: Partial<PlatformBridge> = {}): PlatformBridge {
  const noop = async () => undefined;
  return {
    startKernel: async () => 'ready',
    stopKernel: async () => 'stopped',
    openFile: async () => null,
    readFile: async () => null,
    saveFile: noop,
    saveFileAs: async () => null,
    renameFile: async () => null,
    getStoredValue: async () => null,
    setStoredValue: noop,
    setWindowTitle: noop,
    getPlatform: () => platform,
    openDirectory: async () => null,
    listDirectory: async () => null,
    createFile: async () => null,
    createDirectory: async () => null,
    deleteFile: async () => false,
    ...overrides,
  };
}

export function withPlatform(platform: 'desktop' | 'web', overrides: Partial<PlatformBridge> = {}) {
  const bridge = testBridge(platform, overrides);
  return function Wrapper({ children }: { children: ReactNode }) {
    return <PlatformProvider bridge={bridge}>{children}</PlatformProvider>;
  };
}
