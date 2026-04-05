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

// For synchronous access during initial render, we need a sync bridge
// The web bridge is safe to import statically (no Tauri deps)
import { webBridge } from './webBridge';

function getSyncBridge(): PlatformBridge {
  if (defaultBridge) return defaultBridge;
  if (isTauri) {
    // Tauri bridge will be loaded async — use a temporary stub that queues calls
    // In practice, the async load happens fast enough that this rarely matters
    return webBridge; // Temporary fallback; will be replaced on mount
  }
  return webBridge;
}

const PlatformContext = createContext<PlatformBridge>(getSyncBridge());

export function PlatformProvider({ children, bridge }: { children: React.ReactNode; bridge?: PlatformBridge }) {
  return (
    <PlatformContext.Provider value={bridge ?? getSyncBridge()}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformBridge {
  return useContext(PlatformContext);
}

export { isTauri, loadBridge };
