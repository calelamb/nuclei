import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  Check,
  AlertTriangle,
  Download,
  Trash2,
  RefreshCw,
  Wrench,
  Copy,
  Loader2,
  Terminal,
} from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import type { FrameworkInfo, FrameworkStatus, InstallEvent } from '../../stores/frameworksStore';
import {
  isDesktop,
  getEnvironmentReport,
  getPythonSetup,
  getFrameworkStatus,
  installFrameworks,
  uninstallFrameworks,
  installPython,
  repairVenv,
  type EnvironmentReport,
  type PythonSetup,
} from '../../services/environment';

const GROUP_LABEL: Record<FrameworkInfo['group'], string> = {
  core: 'Frameworks',
  provider: 'Hardware providers',
  research: 'QEC research toolchain',
};
const GROUP_ORDER: FrameworkInfo['group'][] = ['core', 'provider', 'research'];

const PM_LABEL: Record<string, string> = {
  brew: 'Homebrew',
  winget: 'winget',
  'apt-get': 'APT',
  dnf: 'DNF',
  pacman: 'pacman',
};

/**
 * The Environment hub (Settings). One place to see and fix the Python
 * runtime: whether a supported Python is present, install it via the OS
 * package manager when it isn't, install/remove quantum frameworks into
 * Nuclei's managed venv, repair a wedged environment, and copy a diagnostics
 * report. Drives the Rust env commands over IPC; desktop-only.
 */
export function EnvironmentPanel() {
  const colors = useThemeStore((s) => s.colors);

  const [report, setReport] = useState<EnvironmentReport | null>(null);
  const [python, setPython] = useState<PythonSetup | null>(null);
  const [status, setStatus] = useState<FrameworkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const desktop = isDesktop();

  const refresh = useCallback(async () => {
    if (!desktop) {
      setLoading(false);
      return;
    }
    try {
      // Parallel — no request waterfall.
      const [rep, py, st] = await Promise.all([
        getEnvironmentReport(),
        getPythonSetup(),
        getFrameworkStatus(),
      ]);
      setReport(rep);
      setPython(py);
      setStatus(st);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [desktop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live progress from the backend while an operation runs.
  const unlistenRef = useRef<UnlistenFn | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    listen<InstallEvent>('framework-install', (e) => {
      if (!active) return;
      const { stage, framework, line } = e.payload;
      const label = [stage, framework, line].filter(Boolean).join(' · ');
      setLog((prev) => [...prev.slice(-80), label]);
    }).then((un) => {
      if (active) unlistenRef.current = un;
      else un();
    });
    return () => {
      active = false;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [desktop]);

  const installedSet = useMemo(
    () => new Set(status?.installed ?? []),
    [status],
  );
  const grouped = useMemo(() => {
    const cat = status?.catalog ?? [];
    return GROUP_ORDER.map((g) => ({ group: g, items: cat.filter((f) => f.group === g) })).filter(
      (x) => x.items.length > 0,
    );
  }, [status]);

  const runOp = useCallback(
    async (opId: string, fn: () => Promise<unknown>) => {
      setBusy(opId);
      setLog([]);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        await refresh();
        setBusy(null);
      }
    },
    [refresh],
  );

  const copyReport = useCallback(() => {
    if (report) void navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  }, [report]);

  if (!desktop) {
    return (
      <p style={{ fontSize: 12, color: colors.textDim, fontFamily: "'Geist Sans', sans-serif", margin: 0 }}>
        Environment management is available in the desktop app. The web version runs Python in your
        browser via Pyodide.
      </p>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textDim, fontSize: 12 }}>
        <Loader2 size={13} style={{ animation: 'nuclei-spin 800ms linear infinite' }} />
        Checking your environment…
      </div>
    );
  }

  const pythonOk = python?.supported ?? false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: "'Geist Sans', sans-serif" }}>
      {/* Health header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {report?.healthy ? (
          <Check size={15} style={{ color: colors.success }} />
        ) : (
          <AlertTriangle size={15} style={{ color: colors.warning }} />
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
          {report?.healthy ? 'Environment ready' : 'Setup needed'}
        </span>
        <div style={{ flex: 1 }} />
        <IconBtn title="Refresh" onClick={() => void refresh()} colors={colors} busy={busy !== null}>
          <RefreshCw size={13} />
        </IconBtn>
      </div>

      {/* Python */}
      <Card colors={colors}>
        <Row>
          <Label colors={colors}>Python</Label>
          <Mono colors={colors}>
            {python?.found ? python.version ?? 'found' : 'not found'}
          </Mono>
        </Row>
        {python && !pythonOk && (
          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: 12, color: colors.textDim, lineHeight: 1.5, margin: '0 0 10px' }}>
              {python.too_old
                ? `Your Python is older than ${python.min_version}, which the kernel needs. Install a newer one:`
                : `No Python ${python.min_version}+ was found. The kernel needs it to run circuits.`}
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {python.package_manager ? (
                <PrimaryBtn
                  colors={colors}
                  busy={busy === 'python'}
                  onClick={() => void runOp('python', installPython)}
                >
                  <Download size={13} />
                  Install with {PM_LABEL[python.package_manager] ?? python.package_manager}
                </PrimaryBtn>
              ) : null}
              <a
                href={python.download_url}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12, color: colors.accent, textDecoration: 'none' }}
              >
                Download from python.org →
              </a>
            </div>
            {python.install_command && (
              <code
                style={{
                  display: 'block', marginTop: 8, padding: '6px 9px', borderRadius: 5,
                  background: colors.bg, border: `1px solid ${colors.border}`,
                  fontFamily: "'Geist Mono', monospace", fontSize: 11, color: colors.textMuted,
                }}
              >
                {python.install_command}
              </code>
            )}
          </div>
        )}
      </Card>

      {/* Frameworks */}
      {grouped.map(({ group, items }) => (
        <div key={group}>
          <SectionLabel colors={colors}>{GROUP_LABEL[group]}</SectionLabel>
          <Card colors={colors}>
            {items.map((fw, i) => {
              const installed = installedSet.has(fw.id);
              const rowBusy = busy === `fw:${fw.id}`;
              return (
                <div
                  key={fw.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                    borderTop: i === 0 ? 'none' : `1px solid ${colors.border}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>{fw.label}</span>
                      {installed && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: colors.success }}>
                          <Check size={11} /> installed
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {fw.description}
                    </div>
                  </div>
                  <span style={{ fontSize: 10.5, color: colors.textDim, fontFamily: "'Geist Mono', monospace", flexShrink: 0 }}>
                    ~{fw.approximate_size_mb}MB
                  </span>
                  {installed ? (
                    <GhostBtn
                      colors={colors}
                      busy={rowBusy}
                      danger
                      title={`Remove ${fw.label}`}
                      disabled={!pythonOk}
                      onClick={() => void runOp(`fw:${fw.id}`, () => uninstallFrameworks([fw.id]))}
                    >
                      <Trash2 size={12} />
                    </GhostBtn>
                  ) : (
                    <GhostBtn
                      colors={colors}
                      busy={rowBusy}
                      title={pythonOk ? `Install ${fw.label}` : 'Install Python first'}
                      disabled={!pythonOk}
                      onClick={() => void runOp(`fw:${fw.id}`, () => installFrameworks([fw.id]))}
                    >
                      <Download size={12} /> Install
                    </GhostBtn>
                  )}
                </div>
              );
            })}
          </Card>
        </div>
      ))}

      {/* Maintenance */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <GhostBtn
          colors={colors}
          busy={busy === 'repair'}
          title="Rebuild the managed environment, keeping installed frameworks"
          onClick={() => void runOp('repair', repairVenv)}
        >
          <Wrench size={12} /> Repair environment
        </GhostBtn>
        <GhostBtn colors={colors} onClick={copyReport} title="Copy a diagnostics report">
          <Copy size={12} /> Copy report
        </GhostBtn>
      </div>

      {error && (
        <div style={{ border: `1px solid ${colors.error}`, borderRadius: 6, padding: '9px 11px', fontSize: 12, color: colors.error, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
          {error}
        </div>
      )}

      {/* Live log while an op runs */}
      {busy && log.length > 0 && (
        <div>
          <SectionLabel colors={colors}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Terminal size={11} /> Progress
            </span>
          </SectionLabel>
          <pre
            style={{
              margin: 0, padding: 10, borderRadius: 6, border: `1px solid ${colors.border}`,
              background: colors.bg, color: colors.textMuted, fontFamily: "'Geist Mono', monospace",
              fontSize: 10.5, lineHeight: 1.5, maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap',
            }}
          >
            {log.slice(-30).join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── small styled primitives (kept local; match the Settings look) ── */

interface C {
  bg: string; bgElevated: string; border: string; text: string;
  textMuted: string; textDim: string; accent: string; success: string;
  warning: string; error: string;
}

function Card({ colors, children }: { colors: C; children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 12px', background: colors.bg }}>
      {children}
    </div>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{children}</div>;
}
function Label({ colors, children }: { colors: C; children: React.ReactNode }) {
  return <span style={{ fontSize: 12.5, fontWeight: 500, color: colors.text, flex: 1 }}>{children}</span>;
}
function Mono({ colors, children }: { colors: C; children: React.ReactNode }) {
  return <span style={{ fontSize: 11.5, color: colors.textMuted, fontFamily: "'Geist Mono', monospace" }}>{children}</span>;
}
function SectionLabel({ colors, children }: { colors: C; children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.textDim, margin: '0 0 6px' }}>
      {children}
    </div>
  );
}
function IconBtn({ colors, busy, onClick, title, children }: { colors: C; busy?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} title={title} disabled={busy}
      style={{ display: 'flex', alignItems: 'center', padding: 5, borderRadius: 5, background: 'transparent', border: `1px solid ${colors.border}`, color: colors.textMuted, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}
    >
      {children}
    </button>
  );
}
function PrimaryBtn({ colors, busy, onClick, children }: { colors: C; busy?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} disabled={busy}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 6, background: colors.accent, color: '#0a0f1a', border: 'none', fontSize: 12, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif", cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}
    >
      {busy ? <Loader2 size={13} style={{ animation: 'nuclei-spin 800ms linear infinite' }} /> : null}
      {children}
    </button>
  );
}
function GhostBtn({ colors, busy, danger, disabled, onClick, title, children }: { colors: C; busy?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  const off = disabled || busy;
  const color = danger ? colors.error : colors.textMuted;
  return (
    <button
      type="button" onClick={onClick} title={title} disabled={off}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, background: 'transparent', border: `1px solid ${colors.border}`, color, fontSize: 11.5, fontWeight: 500, fontFamily: "'Geist Sans', sans-serif", cursor: off ? 'default' : 'pointer', opacity: off ? 0.45 : 1, flexShrink: 0 }}
    >
      {busy ? <Loader2 size={12} style={{ animation: 'nuclei-spin 800ms linear infinite' }} /> : children}
    </button>
  );
}
