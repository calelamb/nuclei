import { createContext, useContext } from 'react';
import type { PlatformBridge } from './bridge';
import { tauriBridge } from './tauriBridge';

const PlatformContext = createContext<PlatformBridge>(tauriBridge);

export function PlatformProvider({ children, bridge }: { children: React.ReactNode; bridge?: PlatformBridge }) {
  return (
    <PlatformContext.Provider value={bridge ?? tauriBridge}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformBridge {
  return useContext(PlatformContext);
}
