import { useEffect, useState } from 'react';
import { Rocket, Clock, CheckCircle2, XCircle, Loader2, X } from 'lucide-react';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useThemeStore } from '../../stores/themeStore';
import { ProviderLogo } from './ProviderLogo';
import { getHardware } from '../../App';
import type { HardwareProviderType } from '../../types/hardware';

function fmtElapsed(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  if (ms < 1000) return '<1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/**
 * Persistent strip at the top of the editor that surfaces the most recent
 * hardware job. Click to reopen details. Replaces the buried "jobs list"
 * with a live, always-visible status indicator — the way CI status bars do
 * it in GitHub / Linear / Vercel.
 */
export function LaunchStrip() {
  const jobs = useHardwareStore((s) => s.jobs);
  const openLaunch = useHardwareStore((s) => s.openLaunch);
  const clearJob = useHardwareStore((s) => s.clearJob);
  const colors = useThemeStore((s) => s.colors);

  const [, setNow] = useState(0);
  const latestJob = jobs[0] ?? null;
  useEffect(() => {
    if (!latestJob) return;
    if (latestJob.status === 'complete' || latestJob.status === 'failed') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [latestJob]);

  if (!latestJob) return null;

  const statusColor =
    latestJob.status === 'complete'
      ? colors.success
      : latestJob.status === 'failed'
        ? colors.error
        : colors.warning;

  const StatusIcon =
    latestJob.status === 'complete'
      ? CheckCircle2
      : latestJob.status === 'failed'
        ? XCircle
        : Loader2;

  const label =
    latestJob.status === 'queued'
      ? latestJob.queuePosition !== null
        ? `queued · position ${latestJob.queuePosition}`
        : 'queued'
      : latestJob.status === 'running'
        ? 'running'
        : latestJob.status === 'complete'
          ? 'complete'
          : 'failed';

  const cancellable = latestJob.status === 'queued' || latestJob.status === 'running';
  const onCancelClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const hw = getHardware();
    if (cancellable && hw) {
      hw.hardwareCancel(latestJob.id);
    } else {
      // Completed / already failed job — just clear it from the strip so
      // the student can move on.
      clearJob(latestJob.id);
    }
  };

  return (
    <div
      onClick={() => openLaunch()}
      role="button"
      aria-label="Open launch panel"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        margin: '6px 10px 0',
        background: `${statusColor}10`,
        border: `1px solid ${statusColor}30`,
        borderRadius: 10,
        color: colors.text,
        cursor: 'pointer',
        fontFamily: "'Geist Sans', sans-serif",
        fontSize: 11,
        textAlign: 'left',
        width: 'calc(100% - 20px)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `${statusColor}18`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = `${statusColor}10`;
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: statusColor }}>
        <Rocket size={12} />
        <ProviderLogo provider={latestJob.provider as HardwareProviderType} size={14} color={statusColor} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, color: colors.text }}>{latestJob.backend}</span>
          <span style={{ color: colors.textDim }}>· {latestJob.shots} shots</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.textMuted }}>
          <StatusIcon
            size={10}
            style={{
              color: statusColor,
              animation: latestJob.status === 'running' ? 'nuclei-spin 800ms linear infinite' : 'none',
            }}
          />
          {label}
          <Clock size={10} style={{ marginLeft: 4 }} />
          {fmtElapsed(latestJob.submittedAt)}
        </div>
      </div>
      <button
        onClick={onCancelClick}
        aria-label={cancellable ? 'Cancel job' : 'Dismiss job'}
        title={cancellable ? 'Cancel this job' : 'Dismiss'}
        style={{
          background: 'transparent',
          border: `1px solid ${colors.border}`,
          color: colors.textDim,
          cursor: 'pointer',
          padding: '2px 8px',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 10,
          fontWeight: 500,
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
        {cancellable ? 'Cancel' : 'Dismiss'}
      </button>
    </div>
  );
}
