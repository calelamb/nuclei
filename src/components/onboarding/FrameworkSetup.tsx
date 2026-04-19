import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { X, Check, AlertCircle, Loader2, Download, Sparkles } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import {
  useFrameworksStore,
  type FrameworkInfo,
  type FrameworkStatus,
  type InstallEvent,
} from '../../stores/frameworksStore';

interface FrameworkSetupProps {
  open: boolean;
  onClose: () => void;
  /**
   * When `true`, hides the close button and shows the "first-run" copy.
   * False for the "Settings → Frameworks" entry path.
   */
  firstRun?: boolean;
}

/**
 * Framework installer wizard. On first launch students see a checklist
 * of quantum frameworks and optional hardware provider SDKs; the
 * selected set is installed into Nuclei's managed Python venv
 * (`<appDataDir>/venv`) via pip. The kernel picks up that venv
 * automatically on next restart, so frameworks students didn't install
 * just stay absent — no failed imports, no cryptic errors.
 */
export function FrameworkSetup({ open, onClose, firstRun = false }: FrameworkSetupProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const status = useFrameworksStore((s) => s.status);
  const loading = useFrameworksStore((s) => s.loading);
  const installing = useFrameworksStore((s) => s.installing);
  const events = useFrameworksStore((s) => s.events);
  const lastFailures = useFrameworksStore((s) => s.lastFailures);
  const setStatus = useFrameworksStore((s) => s.setStatus);
  const setLoading = useFrameworksStore((s) => s.setLoading);
  const setInstalling = useFrameworksStore((s) => s.setInstalling);
  const appendEvent = useFrameworksStore((s) => s.appendEvent);
  const resetEvents = useFrameworksStore((s) => s.resetEvents);
  const setLastFailures = useFrameworksStore((s) => s.setLastFailures);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [completed, setCompleted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await invoke<FrameworkStatus>('framework_status');
      setStatus(s);
      // Pre-check the recommended frameworks that aren't installed yet.
      if (firstRun) {
        const defaults = new Set(
          s.catalog.filter((f) => f.recommended && !s.installed.includes(f.id)).map((f) => f.id),
        );
        setSelected(defaults);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [setStatus, setLoading, firstRun]);

  useEffect(() => {
    if (open) refreshStatus();
  }, [open, refreshStatus]);

  // Subscribe to the backend's live install events while the modal is open.
  useEffect(() => {
    if (!open) return;
    let un: UnlistenFn | undefined;
    listen<InstallEvent>('framework-install', (e) => appendEvent(e.payload))
      .then((u) => { un = u; });
    return () => { un?.(); };
  }, [open, appendEvent]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runInstall = useCallback(async () => {
    if (installing) return;
    const ids = [...selected];
    if (ids.length === 0) return;
    setInstalling(true);
    setCompleted(false);
    setErrorMsg(null);
    resetEvents(ids);
    try {
      const failures = await invoke<string[]>('framework_install', { frameworks: ids });
      setLastFailures(failures);
      await refreshStatus();
      setCompleted(true);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }, [installing, selected, setInstalling, resetEvents, setLastFailures, refreshStatus]);

  const core = useMemo(
    () => status?.catalog.filter((f) => f.group === 'core') ?? [],
    [status],
  );
  const providers = useMemo(
    () => status?.catalog.filter((f) => f.group === 'provider') ?? [],
    [status],
  );
  const totalMb = useMemo(() => {
    if (!status) return 0;
    return [...selected]
      .map((id) => status.catalog.find((f) => f.id === id)?.approximate_size_mb ?? 0)
      .reduce((a, b) => a + b, 0);
  }, [selected, status]);

  const latestLine = events[events.length - 1];

  if (!open) return null;

  const hasPython = !!status?.system_python_path;

  return (
    <div
      role="presentation"
      onClick={firstRun ? undefined : onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        role="dialog"
        aria-label="Framework setup"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 92vw)',
          maxHeight: '86vh',
          background: colors.bgPanel,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: 12,
          boxShadow: shadow.lg,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 18px',
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <Sparkles size={16} style={{ color: colors.accent }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
              {firstRun ? 'Welcome — set up your quantum frameworks' : 'Quantum frameworks'}
            </div>
            <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
              Pick the libraries you want. Nuclei installs them into a
              private Python environment — no system pollution.
            </div>
          </div>
          {!firstRun && (
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'transparent',
                border: 'none',
                color: colors.textDim,
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', padding: '14px 18px' }}>
          {loading && (
            <div style={{ color: colors.textDim, fontSize: 12, padding: '20px 0' }}>
              Detecting Python + installed frameworks…
            </div>
          )}

          {!loading && !hasPython && (
            <div
              style={{
                padding: 14,
                borderRadius: 8,
                border: `1px solid ${colors.error}66`,
                background: `${colors.error}10`,
                color: colors.text,
                fontSize: 12,
                lineHeight: 1.55,
                marginBottom: 10,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4, color: colors.error }}>
                Python 3 not found
              </div>
              Install Python 3.10 or newer from{' '}
              <a
                href="https://www.python.org/downloads/"
                target="_blank"
                rel="noreferrer"
                style={{ color: colors.accent }}
              >
                python.org
              </a>
              , then reopen this dialog.
            </div>
          )}

          {!loading && hasPython && status && (
            <>
              <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 8 }}>
                Using {status.python_version}
                {status.system_python_path && (
                  <> <span style={{ color: colors.textDim }}>· {status.system_python_path}</span></>
                )}
              </div>

              <SectionHeader label="Core frameworks" />
              {core.map((fw) => (
                <FrameworkRow
                  key={fw.id}
                  fw={fw}
                  checked={selected.has(fw.id)}
                  installed={status.installed.includes(fw.id)}
                  disabled={installing}
                  onToggle={() => toggle(fw.id)}
                />
              ))}

              <div style={{ height: 10 }} />
              <SectionHeader label="Hardware providers (optional)" />
              {providers.map((fw) => (
                <FrameworkRow
                  key={fw.id}
                  fw={fw}
                  checked={selected.has(fw.id)}
                  installed={status.installed.includes(fw.id)}
                  disabled={installing}
                  onToggle={() => toggle(fw.id)}
                />
              ))}
            </>
          )}

          {installing && (
            <div
              style={{
                marginTop: 14,
                padding: 10,
                borderRadius: 8,
                background: colors.bgElevated,
                border: `1px solid ${colors.border}`,
                fontSize: 11,
                color: colors.textMuted,
                fontFamily: "'Fira Code', monospace",
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Loader2
                size={12}
                style={{
                  color: colors.accent,
                  animation: 'nuclei-spin 800ms linear infinite',
                  flexShrink: 0,
                }}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {latestLine
                  ? stageText(latestLine)
                  : 'Preparing environment…'}
              </span>
            </div>
          )}

          {completed && !installing && (
            <div
              style={{
                marginTop: 14,
                padding: 10,
                borderRadius: 8,
                background:
                  lastFailures.length === 0 ? `${colors.success}14` : `${colors.warning}14`,
                border: `1px solid ${
                  lastFailures.length === 0 ? `${colors.success}44` : `${colors.warning}44`
                }`,
                fontSize: 12,
                color: colors.text,
              }}
            >
              {lastFailures.length === 0 ? (
                <>
                  <Check size={12} style={{ color: colors.success, marginRight: 6 }} />
                  All selected frameworks installed. Restart the kernel to pick them up.
                </>
              ) : (
                <>
                  <AlertCircle
                    size={12}
                    style={{ color: colors.warning, marginRight: 6 }}
                  />
                  Some installs failed:
                  <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 11, color: colors.textMuted }}>
                    {lastFailures.map((f, i) => (
                      <li key={i}>{f.split('\n')[0]}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {errorMsg && (
            <div
              style={{
                marginTop: 14,
                padding: 10,
                borderRadius: 8,
                background: `${colors.error}14`,
                border: `1px solid ${colors.error}44`,
                fontSize: 12,
                color: colors.error,
              }}
            >
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 18px',
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <div style={{ flex: 1, fontSize: 11, color: colors.textDim }}>
            {selected.size > 0 ? (
              <>
                {selected.size} selected · ~{totalMb} MB download
              </>
            ) : (
              'Pick the frameworks you want installed.'
            )}
          </div>
          {firstRun && (
            <button
              onClick={onClose}
              style={btnSecondary(colors)}
              disabled={installing}
            >
              Skip for now
            </button>
          )}
          <button
            onClick={runInstall}
            disabled={!hasPython || installing || selected.size === 0}
            style={{
              ...btnPrimary(colors),
              opacity: !hasPython || installing || selected.size === 0 ? 0.5 : 1,
              cursor: !hasPython || installing || selected.size === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {installing ? (
              <>
                <Loader2 size={12} style={{ animation: 'nuclei-spin 800ms linear infinite' }} />
                Installing…
              </>
            ) : (
              <>
                <Download size={12} />
                Install {selected.size > 0 ? `(${selected.size})` : ''}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function stageText(event: InstallEvent): string {
  switch (event.stage) {
    case 'creating-venv':
      return `Creating Python environment… ${event.line ?? ''}`.trim();
    case 'installing':
      return `Installing ${event.framework ?? ''}…`;
    case 'installed':
      return `Installed ${event.framework ?? ''}`;
    case 'failed':
      return `Failed: ${event.framework ?? ''}`;
    case 'done':
      return 'Finishing up…';
    default:
      return event.line ?? '';
  }
}

function SectionHeader({ label }: { label: string }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: colors.textDim,
        margin: '6px 0 4px',
      }}
    >
      {label}
    </div>
  );
}

function FrameworkRow({
  fw,
  checked,
  installed,
  disabled,
  onToggle,
}: {
  fw: FrameworkInfo;
  checked: boolean;
  installed: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '8px 10px',
        marginBottom: 4,
        borderRadius: 8,
        border: `1px solid ${checked ? `${colors.accent}55` : colors.border}`,
        background: checked ? `${colors.accent}0c` : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        style={{ marginTop: 3, accentColor: colors.accent }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{fw.label}</span>
          {installed && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: colors.success,
                background: `${colors.success}18`,
                padding: '2px 6px',
                borderRadius: 4,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              Installed
            </span>
          )}
          {fw.recommended && !installed && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: colors.accentLight,
                background: `${colors.accent}18`,
                padding: '2px 6px',
                borderRadius: 4,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              Recommended
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2, lineHeight: 1.45 }}>
          {fw.description}
        </div>
        <div style={{ fontSize: 10, color: colors.textDim, marginTop: 3 }}>
          ~{fw.approximate_size_mb} MB
        </div>
      </div>
    </label>
  );
}

function btnPrimary(colors: ReturnType<typeof useThemeStore.getState>['colors']): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    background: colors.accent,
    color: '#0a0f1a',
    border: 'none',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "'Geist Sans', sans-serif",
    cursor: 'pointer',
  };
}

function btnSecondary(colors: ReturnType<typeof useThemeStore.getState>['colors']): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    background: 'transparent',
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "'Geist Sans', sans-serif",
    cursor: 'pointer',
  };
}
