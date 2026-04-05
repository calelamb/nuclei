import { useEffect, useState, useCallback } from 'react';
import { PanelLayout } from './components/layout/PanelLayout';
import { PlatformProvider, usePlatform, loadBridge, isTauri } from './platform/PlatformProvider';
import { Onboarding } from './components/onboarding/Onboarding';
import { KeyboardShortcuts } from './components/onboarding/KeyboardShortcuts';
import { CommandPalette, buildCommands } from './components/commandPalette/CommandPalette';
import { useKernel } from './hooks/useKernel';
import { useFileOps } from './hooks/useFileOps';
import { useThemeStore } from './stores/themeStore';
import { useUIModeStore } from './stores/uiModeStore';
import type { PlatformBridge } from './platform/bridge';

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
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const themeToggle = useThemeStore((s) => s.toggle);
  const cycleMode = useUIModeStore((s) => s.cycleMode);

  useEffect(() => {
    executeRef = execute;
    return () => { executeRef = null; };
  }, [execute]);

  useEffect(() => {
    fileOpsRef = fileOps;
  }, [fileOps]);

  // Load persisted theme + UI mode + check onboarding
  useEffect(() => {
    (async () => {
      try {
        const mode = await platform.getStoredValue<'dark' | 'light'>('theme');
        if (mode) useThemeStore.getState().setMode(mode);

        const uiMode = await platform.getStoredValue<'beginner' | 'intermediate' | 'advanced'>('ui_mode');
        if (uiMode) useUIModeStore.getState().setMode(uiMode);

        const onboarded = await platform.getStoredValue<boolean>('onboarding_complete');
        if (!onboarded) setShowOnboarding(true);
      } catch {}
    })();
  }, [platform]);

  const completeOnboarding = useCallback(async (path?: string) => {
    setShowOnboarding(false);
    try {
      await platform.setStoredValue('onboarding_complete', true);
      if (path) {
        await platform.setStoredValue('onboarding_path', path);
        // Set UI mode based on path
        if (path === 'beginner') useUIModeStore.getState().setMode('beginner');
        else if (path === 'intermediate') useUIModeStore.getState().setMode('intermediate');
        else if (path === 'experienced') useUIModeStore.getState().setMode('advanced');
      }
    } catch {}
  }, [platform]);

  const commands = buildCommands({
    run: () => { const fn = getExecute(); if (fn) fn(); },
    openFile: () => fileOps.openFile(),
    saveFile: () => fileOps.saveFile(),
    newFile: () => fileOps.newFile(),
    toggleTheme: themeToggle,
    toggleDirac: () => {}, // TODO: wire to Dirac panel toggle
    cycleMode: () => {
      cycleMode();
      platform.setStoredValue('ui_mode', useUIModeStore.getState().mode).catch(() => {});
    },
    toggleShortcuts: () => setShowShortcuts((s) => !s),
  });

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
      } else if (e.key === '/' && !e.shiftKey) {
        e.preventDefault();
        setShowShortcuts((s) => !s);
      } else if (e.key === 'p' && e.shiftKey) {
        e.preventDefault();
        setShowCommandPalette((s) => !s);
      } else if (e.key === 'l' && e.shiftKey) {
        e.preventDefault();
        cycleMode();
        platform.setStoredValue('ui_mode', useUIModeStore.getState().mode).catch(() => {});
      } else if (e.key === 't' && e.shiftKey) {
        e.preventDefault();
        themeToggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fileOps, themeToggle, cycleMode, platform]);

  return (
    <>
      <PanelLayout />
      {showOnboarding && <Onboarding onComplete={completeOnboarding} />}
      {showShortcuts && <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />}
      {showCommandPalette && <CommandPalette commands={commands} onClose={() => setShowCommandPalette(false)} />}
    </>
  );
}

function App() {
  const [bridge, setBridge] = useState<PlatformBridge | null>(null);

  useEffect(() => {
    loadBridge().then(setBridge);
  }, []);

  if (!bridge) {
    return (
      <div style={{
        width: '100vw', height: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#0F1B2D', color: '#00B4D8',
        fontFamily: "'IBM Plex Sans', Inter, sans-serif", fontSize: 16,
      }}>
        Loading Nuclei{isTauri ? '' : ' (web)'}...
      </div>
    );
  }

  return (
    <PlatformProvider bridge={bridge}>
      <AppInner />
    </PlatformProvider>
  );
}

export default App;
