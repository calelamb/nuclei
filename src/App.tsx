import { useEffect, useState } from 'react';
import { PanelLayout } from './components/layout/PanelLayout';
import { PlatformProvider, usePlatform } from './platform/PlatformProvider';
import { Onboarding } from './components/onboarding/Onboarding';
import { KeyboardShortcuts } from './components/onboarding/KeyboardShortcuts';
import { useKernel } from './hooks/useKernel';
import { useFileOps } from './hooks/useFileOps';
import { useThemeStore } from './stores/themeStore';

// Store execute function globally so Monaco keybinding can access it
let executeRef: (() => void) | null = null;
export function getExecute() { return executeRef; }

// Store file ops globally for keyboard shortcuts
let fileOpsRef: ReturnType<typeof useFileOps> | null = null;
export function getFileOps() { return fileOpsRef; }

function AppInner() {
  const { execute } = useKernel();
  const fileOps = useFileOps();
  const platform = usePlatform();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    executeRef = execute;
    return () => { executeRef = null; };
  }, [execute]);

  useEffect(() => {
    fileOpsRef = fileOps;
  }, [fileOps]);

  // Load persisted theme + check onboarding
  useEffect(() => {
    (async () => {
      try {
        const mode = await platform.getStoredValue<'dark' | 'light'>('theme');
        if (mode) useThemeStore.getState().setMode(mode);

        const onboarded = await platform.getStoredValue<boolean>('onboarding_complete');
        if (!onboarded) setShowOnboarding(true);
      } catch {}
    })();
  }, [platform]);

  const completeOnboarding = async () => {
    setShowOnboarding(false);
    try {
      await platform.setStoredValue('onboarding_complete', true);
    } catch {}
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === 'o') {
        e.preventDefault();
        fileOps.openFile();
      } else if (e.key === 's' && e.shiftKey) {
        e.preventDefault();
        fileOps.saveFileAs();
      } else if (e.key === 's') {
        e.preventDefault();
        fileOps.saveFile();
      } else if (e.key === 'n') {
        e.preventDefault();
        fileOps.newFile();
      } else if (e.key === '/') {
        e.preventDefault();
        setShowShortcuts((s) => !s);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fileOps]);

  return (
    <>
      <PanelLayout />
      {showOnboarding && <Onboarding onComplete={completeOnboarding} />}
      {showShortcuts && <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />}
    </>
  );
}

function App() {
  return (
    <PlatformProvider>
      <AppInner />
    </PlatformProvider>
  );
}

export default App;
