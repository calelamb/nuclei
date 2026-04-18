import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { useThemeStore } from '../stores/themeStore';

type PhaseIdle = { kind: 'idle' };
type PhaseAvailable = { kind: 'available'; version: string; notes?: string };
type PhaseDownloading = { kind: 'downloading'; version: string; percent: number };
type PhaseReady = { kind: 'ready'; version: string };
type PhaseError = { kind: 'error'; message: string };

type Phase = PhaseIdle | PhaseAvailable | PhaseDownloading | PhaseReady | PhaseError;

const DISMISS_STORAGE_KEY = 'nuclei:update_dismissed_version';

/**
 * Quiet update banner. On desktop, checks the configured updater endpoint a
 * few seconds after launch. If a newer signed release is available it asks
 * the user; if they accept it downloads in the background and offers a
 * restart. Dismissing silences the banner for that specific version so the
 * user isn't nagged every launch.
 *
 * On web the Tauri updater modules don't exist — we short-circuit early.
 */
export function UpdateBanner() {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  const runCheck = useCallback(async () => {
    // Dynamically import so the web bundle doesn't pull in the Tauri plugin.
    try {
      const isTauri = '__TAURI_INTERNALS__' in window;
      if (!isTauri) return;
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) {
        setPhase({ kind: 'idle' });
        return;
      }
      const dismissedVersion = window.localStorage.getItem(DISMISS_STORAGE_KEY);
      if (dismissedVersion === update.version) {
        setDismissed(true);
        return;
      }
      setPhase({ kind: 'available', version: update.version, notes: update.body ?? undefined });
    } catch (err) {
      // Silent failure: no network, endpoint 404, signature mismatch, etc.
      // We don't surface these to the user — an absent banner is correct.
      if (import.meta.env.DEV) console.warn('[Nuclei] update check failed:', err);
    }
  }, []);

  useEffect(() => {
    // Small delay so the initial app boot isn't racing the update check.
    const t = window.setTimeout(() => { void runCheck(); }, 4000);
    return () => window.clearTimeout(t);
  }, [runCheck]);

  const handleInstall = useCallback(async () => {
    if (phase.kind !== 'available') return;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) return;
      setPhase({ kind: 'downloading', version: update.version, percent: 0 });
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
          setPhase({ kind: 'downloading', version: update.version, percent });
        } else if (event.event === 'Finished') {
          setPhase({ kind: 'ready', version: update.version });
        }
      });
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Update failed',
      });
    }
  }, [phase]);

  const handleRestart = useCallback(async () => {
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Restart failed',
      });
    }
  }, []);

  const handleDismiss = useCallback(() => {
    if (phase.kind === 'available' || phase.kind === 'ready') {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, phase.version);
    }
    setDismissed(true);
  }, [phase]);

  if (dismissed) return null;
  if (phase.kind === 'idle') return null;

  const title = (() => {
    switch (phase.kind) {
      case 'available':
        return `Nuclei ${phase.version} is available`;
      case 'downloading':
        return `Downloading Nuclei ${phase.version} — ${phase.percent}%`;
      case 'ready':
        return `Nuclei ${phase.version} ready to install`;
      case 'error':
        return 'Update failed';
    }
  })();

  const subtitle = (() => {
    switch (phase.kind) {
      case 'available':
        return 'Verified signed release — updates in the background.';
      case 'downloading':
        return 'Keep the app open while the update downloads.';
      case 'ready':
        return 'Relaunch to finish installing.';
      case 'error':
        return phase.message;
    }
  })();

  const primaryButton = (() => {
    switch (phase.kind) {
      case 'available':
        return (
          <button
            onClick={() => { void handleInstall(); }}
            style={buttonStyle(colors, shadow.sm)}
          >
            <Download size={13} />
            Install update
          </button>
        );
      case 'ready':
        return (
          <button
            onClick={() => { void handleRestart(); }}
            style={buttonStyle(colors, shadow.sm)}
          >
            <RefreshCw size={13} />
            Restart now
          </button>
        );
      case 'downloading':
      case 'error':
        return null;
    }
  })();

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 2000,
        minWidth: 280,
        maxWidth: 360,
        padding: '12px 14px',
        background: colors.bgElevated,
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: 8,
        boxShadow: shadow.lg,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        animation: 'nuclei-slide-up 300ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              color: colors.text,
              fontSize: 13,
              fontFamily: "'Geist Sans', sans-serif",
              fontWeight: 600,
            }}
          >
            {title}
          </div>
          <div
            style={{
              color: colors.textMuted,
              fontSize: 12,
              fontFamily: "'Geist Sans', sans-serif",
              marginTop: 2,
              lineHeight: 1.4,
            }}
          >
            {subtitle}
          </div>
        </div>
        {phase.kind !== 'downloading' && (
          <button
            onClick={handleDismiss}
            aria-label="Dismiss update notification"
            style={{
              background: 'none',
              border: 'none',
              color: colors.textDim,
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {phase.kind === 'downloading' && (
        <div
          style={{
            height: 4,
            width: '100%',
            background: colors.border,
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${phase.percent}%`,
              background: colors.accent,
              transition: 'width 150ms ease',
            }}
          />
        </div>
      )}
      {primaryButton}
    </div>
  );
}

function buttonStyle(
  colors: ReturnType<typeof useThemeStore.getState>['colors'],
  shadowSm: string,
): React.CSSProperties {
  return {
    background: colors.accent,
    color: '#0a0f1a',
    border: 'none',
    borderRadius: 5,
    padding: '6px 12px',
    fontSize: 12,
    fontFamily: "'Geist Sans', sans-serif",
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    boxShadow: shadowSm,
    alignSelf: 'flex-start',
  };
}
