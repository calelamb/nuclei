import { useEffect, useState, useCallback } from 'react';
import { PanelLayout } from './components/layout/PanelLayout';
import { PlatformProvider, usePlatform, loadBridge } from './platform/PlatformProvider';
import { Onboarding } from './components/onboarding/Onboarding';
import { KeyboardShortcuts } from './components/onboarding/KeyboardShortcuts';
import { CommandPalette, buildCommands } from './components/commandPalette/CommandPalette';
import { UpdateBanner } from './components/UpdateBanner';
import { ComposeModal } from './components/dirac/ComposeModal';
import { DiffPreview } from './components/editor/DiffPreview';
import { UnsavedChangesModal } from './components/dialogs/UnsavedChangesModal';
import { LaunchModal } from './components/hardware/LaunchModal';
import { FrameworkSetup } from './components/onboarding/FrameworkSetup';
import { useFrameworksStore, needsFirstRunSetup, type FrameworkStatus } from './stores/frameworksStore';
import { useHardwareStore } from './stores/hardwareStore';
import { useKernel } from './hooks/useKernel';
import { useFileOps } from './hooks/useFileOps';
import { useActiveTabSync } from './hooks/useActiveTabSync';
import { useProjectStore } from './stores/projectStore';
import { useThemeStore } from './stores/themeStore';
import { useEditorStore } from './stores/editorStore';
import { useUIModeStore } from './stores/uiModeStore';
import { useDiracPanelStore } from './stores/diracPanelStore';
import { useBottomPanelStore } from './stores/bottomPanelStore';
import { useSettingsStore } from './stores/settingsStore';
import { runInstallTelemetry } from './services/installTelemetry';
import type { PlatformBridge } from './platform/bridge';
import type { Framework } from './types/quantum';

declare const __APP_VERSION__: string;
const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

// Store execute function globally so Monaco keybinding can access it
let executeRef: (() => void) | null = null;
// eslint-disable-next-line react-refresh/only-export-components
export function getExecute() { return executeRef; }

// Store file ops globally for keyboard shortcuts
let fileOpsRef: ReturnType<typeof useFileOps> | null = null;
// eslint-disable-next-line react-refresh/only-export-components
export function getFileOps() { return fileOpsRef; }

// Hardware senders pulled out of useKernel so LaunchModal / LaunchStrip /
// LaunchPortal can reach the WebSocket without threading the hook through
// every prop.
interface HardwareActions {
  hardwareConnect: (provider: string, credentials: Record<string, string>) => void;
  hardwareSubmit: (provider: string, backend: string, code: string, shots: number) => boolean;
  hardwareCancel: (jobId: string) => void;
}
let hardwareRef: HardwareActions | null = null;
// eslint-disable-next-line react-refresh/only-export-components
export function getHardware() { return hardwareRef; }

function AppInner() {
  const { execute, hardwareConnect, hardwareSubmit, hardwareCancel } = useKernel();
  const fileOps = useFileOps();
  useActiveTabSync();
  const platform = usePlatform();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [lastOpenedFile, setLastOpenedFile] = useState<string | undefined>();
  const [daysSinceLastSession, setDaysSinceLastSession] = useState<number | undefined>();
  const themeToggle = useThemeStore((s) => s.toggle);
  const themeMode = useThemeStore((s) => s.mode);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  const isDirty = useEditorStore((s) => s.isDirty);
  const filePath = useEditorStore((s) => s.filePath);
  const framework = useEditorStore((s) => s.framework);
  const setCode = useEditorStore((s) => s.setCode);
  const setFilePath = useEditorStore((s) => s.setFilePath);
  const setFramework = useEditorStore((s) => s.setFramework);
  const cycleMode = useUIModeStore((s) => s.cycleMode);
  const toggleDirac = useDiracPanelStore((s) => s.toggle);
  const focusDirac = useDiracPanelStore((s) => s.focusInput);
  const frameworksModalOpen = useFrameworksStore((s) => s.modalOpen);
  const frameworksFirstRun = useFrameworksStore((s) => s.modalFirstRun);
  const openFrameworksModal = useFrameworksStore((s) => s.openModal);
  const closeFrameworksModal = useFrameworksStore((s) => s.closeModal);
  const setFrameworksStatus = useFrameworksStore((s) => s.setStatus);

  useEffect(() => {
    executeRef = execute;
    return () => { executeRef = null; };
  }, [execute]);

  useEffect(() => {
    hardwareRef = { hardwareConnect, hardwareSubmit, hardwareCancel };
    return () => { hardwareRef = null; };
  }, [hardwareConnect, hardwareSubmit, hardwareCancel]);

  useEffect(() => {
    fileOpsRef = fileOps;
  }, [fileOps]);

  // Anonymous install + weekly heartbeat ping. Runs once per mount;
  // deduped internally via localStorage. Skipped in dev to avoid polluting
  // stats with our own hot reloads. Respects the anonymous usage stats
  // setting — users can opt out in preferences.
  useEffect(() => {
    if (import.meta.env.DEV) return;
    runInstallTelemetry({
      appVersion: APP_VERSION,
      isEnabled: () =>
        useSettingsStore.getState().general.anonymousUsageStats,
    }).catch(() => { /* never surface telemetry errors */ });
  }, []);

  // First-run framework detection (desktop only). If Nuclei's managed
  // venv doesn't exist yet, or exists but has no core quantum framework
  // installed, surface the setup wizard. The user can skip it; we don't
  // block the UI on it.
  useEffect(() => {
    if (platform.getPlatform() !== 'desktop') return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const status = await invoke<FrameworkStatus>('framework_status');
        if (cancelled) return;
        setFrameworksStatus(status);
        if (needsFirstRunSetup(status)) {
          openFrameworksModal(true);
        }
      } catch {
        // On dev builds where the command may not yet be registered we
        // simply don't prompt — kernel fallback to system python3 still
        // works.
      }
    })();
    return () => { cancelled = true; };
  }, [platform, setFrameworksStatus, openFrameworksModal]);

  // Warn before closing with unsaved changes. Modern browsers ignore
  // preventDefault() alone — returnValue is required for the prompt to fire,
  // and some user-agents still read the string value.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    if (isDirty) {
      window.addEventListener('beforeunload', handler);
    }
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Load persisted theme + UI mode + check onboarding.
  //
  // The prefs reads are individually guarded so one corrupt key doesn't
  // prevent the rest of bootstrap from running. File restore is still
  // best-effort — if the file moved or permissions changed, we drop the
  // stale path instead of crashing the session.
  useEffect(() => {
    (async () => {
      const safeGet = async <T,>(key: string): Promise<T | null> => {
        try {
          return await platform.getStoredValue<T>(key);
        } catch (err) {
          if (import.meta.env.DEV) console.warn('[Nuclei] pref read failed:', key, err);
          return null;
        }
      };

      const mode = await safeGet<'dark' | 'light'>('theme');
      if (mode) useThemeStore.getState().setMode(mode);

      const uiMode = await safeGet<'beginner' | 'intermediate' | 'advanced'>('ui_mode');
      if (uiMode) useUIModeStore.getState().setMode(uiMode);

      const lastFramework = await safeGet<Framework>('last_framework');
      if (lastFramework) setFramework(lastFramework);

      const onboarded = await safeGet<boolean>('onboarding_complete');
      if (!onboarded) {
        setShowOnboarding(true);
      } else {
        const lastSession = await safeGet<string>('last_session_date');
        const lastFile = await safeGet<string>('last_opened_file');
        if (lastSession) {
          const days = Math.floor((Date.now() - new Date(lastSession).getTime()) / (1000 * 60 * 60 * 24));
          if (days > 0) {
            setIsReturningUser(true);
            setDaysSinceLastSession(days);
            if (lastFile) setLastOpenedFile(lastFile);
            if (days > 1) setShowOnboarding(true);
          }
        }

        if (lastFile) {
          try {
            const restoredContent = await platform.readFile(lastFile);
            // Empty string is a valid file; only bail on null (missing/unreadable).
            if (restoredContent !== null) {
              setCode(restoredContent);
              setFilePath(lastFile);
            } else {
              // Drop the stale path so we don't retry next session.
              await platform.setStoredValue('last_opened_file', null).catch(() => {});
            }
          } catch (err) {
            if (import.meta.env.DEV) console.warn('[Nuclei] file restore failed:', err);
            await platform.setStoredValue('last_opened_file', null).catch(() => {});
          }
        }

        // Restore last project folder + open tabs. We restore the root first
        // so the sidebar can populate; tabs come from a per-root key so
        // switching folders doesn't pollute the restore list.
        const storedRoot = await safeGet<string>('project_root');
        if (storedRoot) {
          useProjectStore.getState().setProjectRoot(storedRoot);
          const openPaths = await safeGet<string[]>(`project_tabs:${storedRoot}`);
          if (openPaths) {
            for (const p of openPaths) {
              const content = await platform.readFile(p).catch(() => null);
              if (content !== null) {
                useProjectStore.getState().openTab({ path: p, content });
              }
            }
          }
          const activePath = await safeGet<string>(`project_active:${storedRoot}`);
          if (activePath) useProjectStore.getState().setActiveTab(activePath);
        }
      }

      await platform.setStoredValue('last_session_date', new Date().toISOString()).catch(() => {});
    })();
  }, [platform, setCode, setFilePath, setFramework]);

  useEffect(() => {
    platform.setStoredValue('last_framework', framework).catch(() => {});
  }, [framework, platform]);

  // Persist open-tab list + active-tab per project folder so a prof comes
  // back to exactly the same workspace on next launch.
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const projectTabs = useProjectStore((s) => s.tabs);
  const projectActiveTabPath = useProjectStore((s) => s.activeTabPath);
  useEffect(() => {
    if (!projectRoot) return;
    const paths = projectTabs.map((t) => t.path);
    platform.setStoredValue(`project_tabs:${projectRoot}`, paths).catch(() => {});
    platform
      .setStoredValue(`project_active:${projectRoot}`, projectActiveTabPath)
      .catch(() => {});
  }, [projectRoot, projectTabs, projectActiveTabPath, platform]);

  useEffect(() => {
    if (!filePath) return;
    platform.setStoredValue('last_opened_file', filePath).catch(() => {});
  }, [filePath, platform]);

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
      } else if (e.key === 'i' && !e.shiftKey) {
        e.preventDefault();
        setComposeOpen((s) => !s);
      } else if (e.key === 'r' && e.shiftKey) {
        e.preventDefault();
        // ⌘⇧R: open the Launch modal (submit to hardware). Separate from the
        // plain ⌘↵ Run which stays on the classical simulator.
        useHardwareStore.getState().openLaunch();
      } else if (e.key === '`') {
        e.preventDefault();
        // ⌘`: toggle the bottom panel; opening it always focuses the terminal
        // tab so print-debug output is immediately visible.
        const store = useBottomPanelStore.getState();
        if (store.collapsed) {
          store.focusTerminal();
        } else if (store.activeTab !== 'terminal') {
          store.setActiveTab('terminal');
        } else {
          store.setCollapsed(true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fileOps, themeToggle, cycleMode, platform, toggleDirac, focusDirac]);

  return (
    <>
      <PanelLayout />
      <UpdateBanner />
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
      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
      <DiffPreview />
      <UnsavedChangesModal />
      <LaunchModal />
      <FrameworkSetup
        open={frameworksModalOpen}
        firstRun={frameworksFirstRun}
        onClose={closeFrameworksModal}
      />
    </>
  );
}

function SplashScreen() {
  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 16,
      backgroundColor: 'var(--color-surface-sunken)',
    }}>
      <div style={{
        color: 'var(--color-accent-quantum)',
        fontSize: 36,
        fontWeight: 800,
        fontFamily: 'var(--font-sans)',
        letterSpacing: -1,
        animation: 'nuclei-fade-in var(--duration-slow) var(--ease-emphasized-out)',
      }}>
        NUCLEI
      </div>
      <div style={{
        color: 'var(--color-text-tertiary)',
        fontSize: 13,
        fontFamily: 'var(--font-sans)',
      }}>
        Quantum Computing IDE
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: 4, height: 4, borderRadius: '50%',
            backgroundColor: 'var(--color-accent-quantum)',
            animation: `nuclei-dots 1.2s var(--ease-emphasized-out) ${i * 150}ms infinite`,
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
