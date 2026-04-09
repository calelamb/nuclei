import { useEffect, useState, useCallback } from 'react';
import { PanelLayout } from './components/layout/PanelLayout';
import { PlatformProvider, usePlatform, loadBridge } from './platform/PlatformProvider';
import { Onboarding } from './components/onboarding/Onboarding';
import { KeyboardShortcuts } from './components/onboarding/KeyboardShortcuts';
import { CommandPalette, buildCommands } from './components/commandPalette/CommandPalette';
import { useKernel } from './hooks/useKernel';
import { useFileOps } from './hooks/useFileOps';
import { useThemeStore } from './stores/themeStore';
import { useEditorStore } from './stores/editorStore';
import { useUIModeStore } from './stores/uiModeStore';
import { useDiracPanelStore } from './stores/diracPanelStore';
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
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [lastOpenedFile, setLastOpenedFile] = useState<string | undefined>();
  const [daysSinceLastSession, setDaysSinceLastSession] = useState<number | undefined>();
  const themeToggle = useThemeStore((s) => s.toggle);
  const isDirty = useEditorStore((s) => s.isDirty);
  const cycleMode = useUIModeStore((s) => s.cycleMode);
  const toggleDirac = useDiracPanelStore((s) => s.toggle);
  const focusDirac = useDiracPanelStore((s) => s.focusInput);

  useEffect(() => {
    executeRef = execute;
    return () => { executeRef = null; };
  }, [execute]);

  useEffect(() => {
    fileOpsRef = fileOps;
  }, [fileOps]);

  // Warn before closing with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    if (isDirty) {
      window.addEventListener('beforeunload', handler);
    }
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Load persisted theme + UI mode + check onboarding
  useEffect(() => {
    (async () => {
      try {
        const mode = await platform.getStoredValue<'dark' | 'light'>('theme');
        if (mode) useThemeStore.getState().setMode(mode);

        const uiMode = await platform.getStoredValue<'beginner' | 'intermediate' | 'advanced'>('ui_mode');
        if (uiMode) useUIModeStore.getState().setMode(uiMode);

        const onboarded = await platform.getStoredValue<boolean>('onboarding_complete');
        if (!onboarded) {
          setShowOnboarding(true);
        } else {
          // Check for returning user experience
          const lastSession = await platform.getStoredValue<string>('last_session_date');
          const lastFile = await platform.getStoredValue<string>('last_opened_file');
          if (lastSession) {
            const days = Math.floor((Date.now() - new Date(lastSession).getTime()) / (1000 * 60 * 60 * 24));
            if (days > 0) {
              setIsReturningUser(true);
              setDaysSinceLastSession(days);
              if (lastFile) setLastOpenedFile(lastFile);
              // Only show returning screen if >1 day away
              if (days > 1) setShowOnboarding(true);
            }
          }
        }

        // Record this session
        await platform.setStoredValue('last_session_date', new Date().toISOString());
      } catch {
        // Non-critical: theme/preferences persistence failure is safe to ignore
      }
    })();
  }, [platform]);

  const completeOnboarding = useCallback(async (path?: string) => {
    setShowOnboarding(false);
    try {
      await platform.setStoredValue('onboarding_complete', true);
      if (path) {
        await platform.setStoredValue('onboarding_path', path);
        if (path === 'beginner') useUIModeStore.getState().setMode('beginner');
        else if (path === 'intermediate') useUIModeStore.getState().setMode('intermediate');
        else if (path === 'experienced') useUIModeStore.getState().setMode('advanced');
      }
    } catch {
      // Non-critical: onboarding state persistence failure is safe to ignore
    }
  }, [platform]);

  const commands = buildCommands({
    run: () => { const fn = getExecute(); if (fn) fn(); },
    openFile: () => fileOps.openFile(),
    saveFile: () => fileOps.saveFile(),
    newFile: () => fileOps.newFile(),
    toggleTheme: () => {
      themeToggle();
      platform.setStoredValue('theme', useThemeStore.getState().mode).catch(() => {});
    },
    toggleDirac,
    cycleMode: () => {
      cycleMode();
      // Non-critical: UI mode persistence failure does not affect current session
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
        // Non-critical: UI mode persistence failure does not affect current session
        platform.setStoredValue('ui_mode', useUIModeStore.getState().mode).catch(() => {});
      } else if (e.key === 't' && e.shiftKey) {
        e.preventDefault();
        themeToggle();
        platform.setStoredValue('theme', useThemeStore.getState().mode).catch(() => {});
      } else if (e.key === 'd' && !e.shiftKey) {
        e.preventDefault();
        toggleDirac();
      } else if (e.key === 'l' && !e.shiftKey) {
        e.preventDefault();
        focusDirac();
      } else if (e.key === 'j' && !e.shiftKey) {
        e.preventDefault();
        // Toggle bottom panel — handled in PanelLayout via store
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fileOps, themeToggle, cycleMode, platform, toggleDirac, focusDirac]);

  return (
    <>
      <PanelLayout />
      {showOnboarding && (
        <Onboarding
          onComplete={completeOnboarding}
          isReturningUser={isReturningUser}
          lastOpenedFile={lastOpenedFile}
          daysSinceLastSession={daysSinceLastSession}
        />
      )}
      {showShortcuts && <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />}
      {showCommandPalette && <CommandPalette commands={commands} onClose={() => setShowCommandPalette(false)} />}
    </>
  );
}

function SplashScreen() {
  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 16,
      backgroundColor: '#080E18',
    }}>
      <div style={{
        color: '#00B4D8',
        fontSize: 36,
        fontWeight: 800,
        fontFamily: "'Geist Sans', Inter, sans-serif",
        letterSpacing: -1,
        animation: 'nuclei-fade-in 400ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        NUCLEI
      </div>
      <div style={{
        color: '#475569',
        fontSize: 13,
        fontFamily: "'Geist Sans', Inter, sans-serif",
      }}>
        Quantum Computing IDE
      </div>
      {/* Subtle loading indicator */}
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: 4, height: 4, borderRadius: '50%',
            backgroundColor: '#00B4D8',
            animation: `nuclei-dots 1.2s cubic-bezier(0.4, 0, 0.2, 1) ${i * 150}ms infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

function App() {
  const [bridge, setBridge] = useState<PlatformBridge | null>(null);

  useEffect(() => {
    loadBridge().then(setBridge);
  }, []);

  if (!bridge) {
    return <SplashScreen />;
  }

  return (
    <PlatformProvider bridge={bridge}>
      <AppInner />
    </PlatformProvider>
  );
}

export default App;
