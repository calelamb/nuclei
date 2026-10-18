import { Button } from '../ui';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Copy, ExternalLink, RotateCw } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { describeKernelFailure } from '../../lib/kernelErrors';
import { registerKernelBannerFocus, retryKernel } from '../../lib/kernelControl';
import { openExternal } from '../../lib/openExternal';

/**
 * Sits under the editor tabs. While the kernel boots it draws a thin
 * determinate bar (the stage text lives in the Run button and status bar);
 * when the kernel fails it explains why, in the kernel's own words, with the
 * actions a student needs: Retry, Copy details, and the troubleshooting page.
 */
export function KernelBanner() {
  const status = useEditorStore((s) => s.kernelStatus);
  const ready = useEditorStore((s) => s.kernelReady);
  const error = useEditorStore((s) => s.kernelError);
  const progress = useEditorStore((s) => s.kernelProgress);
  const colors = useThemeStore((s) => s.colors);
  const [copied, setCopied] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const failed = status === 'failed' && !ready;

  // The status bar sends people here instead of retrying on its own: one place owns Retry.
  useEffect(() => {
    if (!failed) return undefined;
    registerKernelBannerFocus(() => {
      bannerRef.current?.scrollIntoView?.({ block: 'nearest' });
      bannerRef.current?.querySelector<HTMLElement>('button')?.focus();
    });
    return () => registerKernelBannerFocus(null);
  }, [failed]);

  if (failed) {
    const failure = describeKernelFailure(error);
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(`${failure.title}\n${failure.message}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        setCopied(false); // clipboard blocked: the message is selectable on screen anyway
      }
    };
    return (
      <div
        ref={bannerRef}
        role="alert"
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
          background: colors.bgElevated, borderBottom: `1px solid ${colors.border}`,
          borderLeft: `3px solid ${colors.error}`, flexShrink: 0,
        }}
      >
        <AlertTriangle size={15} color={colors.error} style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: colors.text, fontSize: 13, fontWeight: 600 }}>{failure.title}</div>
          <div style={{ color: colors.textMuted, fontSize: 12, marginTop: 2, userSelect: 'text', wordBreak: 'break-word' }}>
            {failure.detail}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Button size="sm" variant="primary" onClick={retryKernel} icon={<RotateCw size={12} />}>Retry</Button>
            <Button size="sm" onClick={copy} icon={<Copy size={12} />}>{copied ? 'Copied' : 'Copy details'}</Button>
            <Button size="sm" onClick={() => { void openExternal(failure.docsUrl); }} icon={<ExternalLink size={12} />}>Troubleshooting</Button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'connecting' && !ready) {
    const fraction = progress ? Math.max(0.04, Math.min(1, progress.fraction)) : 0.04;
    return (
      <div
        role="progressbar"
        aria-label={progress ? progress.label : 'Starting the kernel'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        style={{ height: 2, background: colors.border, flexShrink: 0 }}
      >
        <div style={{ height: '100%', width: `${fraction * 100}%`, background: colors.accent, transition: 'width 400ms ease' }} />
      </div>
    );
  }

  return null;
}
