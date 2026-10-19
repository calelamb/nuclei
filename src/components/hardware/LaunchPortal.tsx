import { Button, Tooltip, useConfirm } from '../ui';
import { useState, useCallback, useRef } from 'react';
import { Rocket, Upload, FileCode, CheckCircle2, XCircle, Loader2, Clock, X } from 'lucide-react';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
import { ProviderLogo } from './ProviderLogo';
import { PortalProviderCard } from './PortalProviderCard';
import { PROVIDERS, type ProviderMeta } from './launchProviders';
import { useFrameworksStore } from '../../stores/frameworksStore';
import { getExecute, getHardware } from '../../App';
import { usePlatform } from '../../platform/PlatformProvider';
import { providerAllowsQsharp, providerStatus, sortProvidersForDisplay, QSHARP_GATE_TOOLTIP, type ProviderStatus } from './launchGating';
import type { HardwareProviderType } from '../../types/hardware';

import './launchPortal.css';
import { TYPOGRAPHY } from '../../styles/tokens';
function fmtElapsed(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  if (ms < 1000) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function LaunchPortal() {
  const { confirm, confirmDialog } = useConfirm();
  const colors = useThemeStore((s) => s.colors);
  const isWeb = usePlatform().getPlatform() === 'web';
  const jobs = useHardwareStore((s) => s.jobs);
  const providerList = useHardwareStore((s) => s.providers);
  const cudaqInstalled = useFrameworksStore((s) => s.status?.installed.includes('cuda-q') ?? false);
  const kernelStatus = useEditorStore((s) => s.kernelStatus);
  const connected = new Set(providerList.filter((p) => p.connected).map((p) => p.name));
  const results = useHardwareStore((s) => s.results);
  const openLaunch = useHardwareStore((s) => s.openLaunch);
  const selectProvider = useHardwareStore((s) => s.selectProvider);
  const setCode = useEditorStore((s) => s.setCode);
  const setFilePath = useEditorStore((s) => s.setFilePath);
  const framework = useEditorStore((s) => s.framework);
  const openTab = useProjectStore((s) => s.openTab);
  const currentFilePath = useEditorStore((s) => s.filePath);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [lastDropped, setLastDropped] = useState<string | null>(null);

  const setStagedSubmission = useHardwareStore((s) => s.setStagedSubmission);
  const readFile = useCallback(
    async (file: File) => {
      const content = await file.text();
      const pseudoPath = `~dropped/${file.name}`;
      // Open into a temp buffer so the student can see what they're about
      // to submit; also stage it explicitly for the launcher.
      try {
        openTab({ path: pseudoPath, content });
      } catch {
        setCode(content);
        setFilePath(file.name);
      }
      setLastDropped(file.name);
      setStagedSubmission({ fileName: file.name, content });
      // One-step action: drop a file → modal opens on the provider picker so
      // the student doesn't have to hunt for the grid below.
      useHardwareStore.getState().selectProvider(null);
      useHardwareStore.getState().openLaunch();
    },
    [openTab, setCode, setFilePath, setStagedSubmission],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (!/\.(py|qasm|ipynb|qs)$/i.test(file.name)) return;
      void readFile(file);
    },
    [readFile],
  );

  const handleFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      void readFile(file);
      e.target.value = '';
    },
    [readFile],
  );

  // When the editor holds Q#, only Azure Quantum + the Local Simulator can
  // take the submission. Cosmetic — the kernel enforces the same allowlist.
  // Deliberate asymmetry with LaunchModal: the portal gates on the editor's
  // framework because no staged file exists yet at provider-pick time;
  // LaunchModal re-derives from submissionLanguage(), which a staged
  // .qs/.py file can override.
  const qsharpBlocks = (provider: HardwareProviderType) =>
    framework === 'qsharp' && !providerAllowsQsharp(provider);

  const handlePickProvider = (name: HardwareProviderType, status: ProviderStatus) => {
    if (status.kind === 'coming-soon' || qsharpBlocks(name)) return;
    // The browser build has no hardware path: the simulator card runs the circuit right here.
    if (isWeb && name === 'simulator') {
      getExecute()?.();
      return;
    }
    // Desktop-only providers open the launcher at its provider step, where the Download note lives (one Esc closes it).
    selectProvider(isWeb ? null : name);
    openLaunch();
  };

  const statusFor = (p: ProviderMeta) =>
    providerStatus({ provider: p.name, connected: connected.has(p.name), isWeb, cudaqInstalled, kernelStatus });
  const orderedProviders = sortProvidersForDisplay(PROVIDERS, (p) => statusFor(p).kind);

  const openLaunchBlank = () => {
    selectProvider(null);
    openLaunch();
  };

  const completedJobs = jobs.filter((j) => j.status === 'complete').slice(0, 5);
  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const stagedSubmission = useHardwareStore((s) => s.stagedSubmission);
  const activeFileName =
    stagedSubmission?.fileName ??
    lastDropped ??
    (currentFilePath ? currentFilePath.split('/').pop() : null);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      {confirmDialog}
      {/* Drop zone */}
      <div style={{ padding: 12 }}>
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose a .py or .qs file to launch"
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          style={{
            border: `1.5px dashed ${dragActive ? colors.accent : colors.border}`,
            background: dragActive ? `${colors.accent}08` : colors.bgElevated,
            borderRadius: 'var(--radius-round)',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            transition: 'border-color var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard)',
            fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          <Upload size={16} style={{ color: dragActive ? colors.accentText : colors.textMuted }} />
          <div style={{ fontSize: 11, color: colors.text, textAlign: 'center', lineHeight: 1.5 }}>
            Drop a <code style={{ fontFamily: TYPOGRAPHY.fontMono, color: colors.accentText }}>.py</code>{' '}
            or <code style={{ fontFamily: TYPOGRAPHY.fontMono, color: colors.accentText }}>.qs</code>{' '}
            or click to browse
          </div>
          {activeFileName && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color: colors.textDim,
                background: `${colors.success}12`,
                border: `1px solid ${colors.success}30`,
                borderRadius: 6,
                padding: '3px 8px',
                maxWidth: '100%',
                minWidth: 0,
              }}
            >
              <FileCode size={12} style={{ color: colors.success, flexShrink: 0 }} />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                {activeFileName}
              </span>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".py,.qasm,.ipynb,.qs"
          onChange={handleFilePick}
          style={{ display: 'none' }}
        />
      </div>

      {/* Provider grid */}
      <div style={{ padding: '0 12px 12px' }}>
        <div className="nuclei-overline" style={{ marginBottom: 8 }}>
          Choose a destination
        </div>
        <div className="launch-grid">
          {orderedProviders.map((p) => {
            const status = statusFor(p);
            const qsharpBlocked = qsharpBlocks(p.name);
            const comingSoon = status.kind === 'coming-soon';
            const desktopOnly = status.kind === 'desktop-only';
            const reason = comingSoon ? status.label : qsharpBlocked ? QSHARP_GATE_TOOLTIP : null;
            return (
              <PortalProviderCard
                key={p.name}
                provider={p}
                status={status}
                reason={reason}
                inert={comingSoon || desktopOnly || qsharpBlocked}
                onPick={() => handlePickProvider(p.name, status)}
              />
            );
          })}
        </div>

        <Button variant="primary" style={{ marginTop: 10, width: '100%' }} onClick={openLaunchBlank} icon={<Rocket size={14} />}>
          Open full launcher
          <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 4 }}>⌘⇧R</span>
        </Button>
      </div>

      {/* Active jobs */}
      {activeJobs.length > 0 && (
        <div style={{ padding: '0 12px 12px' }}>
          <div className="nuclei-overline" style={{ marginBottom: 6 }}>
            Active jobs
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeJobs.map((j) => (
              <div
                key={j.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  background: colors.bgElevated,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: TYPOGRAPHY.fontSans,
                }}
              >
                <Loader2
                  size={12}
                  style={{
                    color: colors.warning,
                    animation: 'nuclei-spin 800ms linear infinite',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      color: colors.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: 500,
                    }}
                  >
                    {j.backend}
                  </div>
                  <div style={{ color: colors.textDim, fontSize: 11 }}>
                    {j.status}
                    {j.queuePosition !== null && ` · pos ${j.queuePosition}`}
                  </div>
                </div>
                <ProviderLogo provider={j.provider as HardwareProviderType} size={14} color={colors.textDim} />
                <Tooltip label="Cancel job" placement="above">
                <button className="nuclei-hover-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    const hw = getHardware();
                    if (hw) hw.hardwareCancel(j.id);
                  }}
                  aria-label={`Cancel ${j.backend}`}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${colors.border}`,
                    color: colors.textDim,
                    cursor: 'pointer',
                    padding: '2px 6px',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    fontSize: 11,
                    fontFamily: TYPOGRAPHY.fontSans,
                  }}
                >
                  <X size={12} />
                </button>
                </Tooltip>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent results */}
      {completedJobs.length > 0 && (
        <div style={{ padding: '0 12px 12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <div className="nuclei-overline">
              Recent results
            </div>
            <button className="nuclei-hover-text"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Clear all hardware jobs?',
                  description: 'They are removed from the list.',
                  confirmLabel: 'Clear',
                  cancelLabel: 'Keep jobs',
                  tone: 'danger',
                });
                if (ok) useHardwareStore.getState().clearJobs();
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: colors.textDim,
                cursor: 'pointer',
                padding: 0,
                fontSize: 11,
                fontFamily: TYPOGRAPHY.fontSans,
              }}
            >
              Clear all
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {completedJobs.map((j) => {
              const hasResult = !!results[j.id];
              return (
                <div
                  key={j.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    background: `${colors.success}08`,
                    border: `1px solid ${colors.success}20`,
                    borderRadius: 6,
                    fontSize: 11,
                    fontFamily: TYPOGRAPHY.fontSans,
                  }}
                >
                  {hasResult ? (
                    <CheckCircle2 size={12} style={{ color: colors.success }} />
                  ) : (
                    <XCircle size={12} style={{ color: colors.error }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        color: colors.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {j.backend}
                    </div>
                    <div
                      style={{
                        color: colors.textDim,
                        fontSize: 11,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Clock size={12} />
                      {fmtElapsed(j.submittedAt)}
                    </div>
                  </div>
                  <ProviderLogo provider={j.provider as HardwareProviderType} size={14} color={colors.textDim} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
