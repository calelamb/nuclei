import { useState, useCallback, useRef } from 'react';
import { Rocket, Upload, FileCode, CheckCircle2, XCircle, Loader2, Clock, X } from 'lucide-react';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
import { ProviderLogo } from './ProviderLogo';
import { getHardware } from '../../App';
import type { HardwareProviderType } from '../../types/hardware';

interface ProviderPortalMeta {
  name: HardwareProviderType;
  label: string;
  tagline: string;
  disabled?: boolean;
}

const PORTAL_PROVIDERS: ProviderPortalMeta[] = [
  { name: 'ibm', label: 'IBM Quantum', tagline: 'Superconducting · free tier' },
  { name: 'ionq', label: 'IonQ', tagline: 'Trapped ion · all-to-all' },
  { name: 'quantinuum', label: 'Quantinuum', tagline: 'Highest fidelity · H1/H2' },
  { name: 'braket', label: 'AWS Braket', tagline: 'IonQ · Rigetti · QuEra · IQM · OQC · Pasqal' },
  { name: 'azure', label: 'Azure Quantum', tagline: 'Quantinuum · IonQ · Rigetti · Pasqal · IQM' },
  { name: 'nvidia', label: 'NVIDIA CUDA-Q', tagline: 'GPU simulator · up to 34 qubits' },
  { name: 'simulator', label: 'Local Simulator', tagline: 'Instant · no account' },
  { name: 'google', label: 'Google Quantum AI', tagline: 'Research access only', disabled: true },
  { name: 'xanadu', label: 'Xanadu', tagline: 'Photonic · different model', disabled: true },
  { name: 'dwave', label: 'D-Wave', tagline: 'Annealer · different model', disabled: true },
];

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
  const colors = useThemeStore((s) => s.colors);
  const jobs = useHardwareStore((s) => s.jobs);
  const results = useHardwareStore((s) => s.results);
  const openLaunch = useHardwareStore((s) => s.openLaunch);
  const selectProvider = useHardwareStore((s) => s.selectProvider);
  const setCode = useEditorStore((s) => s.setCode);
  const setFilePath = useEditorStore((s) => s.setFilePath);
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
      if (!/\.(py|qasm|ipynb)$/i.test(file.name)) return;
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

  const handlePickProvider = (p: ProviderPortalMeta) => {
    if (p.disabled) return;
    selectProvider(p.name);
    openLaunch();
  };

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
      {/* Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Rocket size={14} style={{ color: colors.accent }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: colors.textMuted,
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          Launch
        </span>
      </div>

      {/* Drop zone */}
      <div style={{ padding: 12 }}>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `1.5px dashed ${dragActive ? colors.accent : colors.border}`,
            background: dragActive ? `${colors.accent}08` : colors.bgElevated,
            borderRadius: 10,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            transition: 'border-color 120ms ease, background 120ms ease',
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          <Upload size={18} style={{ color: dragActive ? colors.accent : colors.textMuted }} />
          <div style={{ fontSize: 11, color: colors.text, textAlign: 'center', lineHeight: 1.5 }}>
            Drop a <code style={{ fontFamily: "'JetBrains Mono', monospace", color: colors.accentLight }}>.py</code>{' '}
            or click to browse
          </div>
          {activeFileName && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 10,
                color: colors.textDim,
                background: `${colors.success}12`,
                border: `1px solid ${colors.success}30`,
                borderRadius: 6,
                padding: '3px 8px',
              }}
            >
              <FileCode size={11} style={{ color: colors.success }} />
              <span>{activeFileName}</span>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".py,.qasm,.ipynb"
          onChange={handleFilePick}
          style={{ display: 'none' }}
        />
      </div>

      {/* Provider grid */}
      <div style={{ padding: '0 12px 12px' }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: colors.textMuted,
            marginBottom: 8,
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          Choose a destination
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {PORTAL_PROVIDERS.map((p) => (
            <button
              key={p.name}
              onClick={() => handlePickProvider(p)}
              disabled={p.disabled}
              title={p.tagline}
              style={{
                textAlign: 'left',
                background: colors.bgElevated,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: 10,
                cursor: p.disabled ? 'not-allowed' : 'pointer',
                color: colors.text,
                fontFamily: "'Geist Sans', sans-serif",
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                opacity: p.disabled ? 0.5 : 1,
                transition: 'border-color 120ms ease, background 120ms ease, transform 120ms ease',
              }}
              onMouseEnter={(e) => {
                if (p.disabled) return;
                e.currentTarget.style.borderColor = colors.accent;
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  background: `${colors.accent}14`,
                  color: colors.accentLight,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ProviderLogo provider={p.name} size={20} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: colors.text }}>{p.label}</div>
              <div
                style={{
                  fontSize: 10,
                  color: colors.textDim,
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical' as const,
                }}
              >
                {p.tagline}
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={openLaunchBlank}
          style={{
            marginTop: 10,
            width: '100%',
            padding: '8px 10px',
            background: colors.accent,
            color: '#0a0f1a',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Rocket size={13} /> Open full launcher
          <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>⌘⇧R</span>
        </button>
      </div>

      {/* Active jobs */}
      {activeJobs.length > 0 && (
        <div style={{ padding: '0 12px 12px' }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              color: colors.textMuted,
              marginBottom: 6,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
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
                  fontFamily: "'Geist Sans', sans-serif",
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
                  <div style={{ color: colors.textDim, fontSize: 10 }}>
                    {j.status}
                    {j.queuePosition !== null && ` · pos ${j.queuePosition}`}
                  </div>
                </div>
                <ProviderLogo provider={j.provider as HardwareProviderType} size={14} color={colors.textDim} />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const hw = getHardware();
                    if (hw) hw.hardwareCancel(j.id);
                  }}
                  aria-label={`Cancel ${j.backend}`}
                  title="Cancel job"
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
                    fontSize: 10,
                    fontFamily: "'Geist Sans', sans-serif",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = colors.error;
                    e.currentTarget.style.borderColor = `${colors.error}60`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = colors.textDim;
                    e.currentTarget.style.borderColor = colors.border;
                  }}
                >
                  <X size={10} />
                </button>
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
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: colors.textMuted,
                fontFamily: "'Geist Sans', sans-serif",
              }}
            >
              Recent results
            </div>
            <button
              onClick={() => useHardwareStore.getState().clearJobs()}
              style={{
                background: 'transparent',
                border: 'none',
                color: colors.textDim,
                cursor: 'pointer',
                padding: 0,
                fontSize: 10,
                fontFamily: "'Geist Sans', sans-serif",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
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
                    fontFamily: "'Geist Sans', sans-serif",
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
                        fontSize: 10,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Clock size={9} />
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
