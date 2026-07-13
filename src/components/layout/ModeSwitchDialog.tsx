import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useThemeStore } from '../../stores/themeStore';
import { useModeSwitchStore } from '../../stores/modeSwitchStore';

/**
 * PRD 11 Phase B — the in-flight-work confirm dialog.
 *
 * Rendered once at the layout root. Appears only when `requestSwitch` staged
 * a switch while a sweep/campaign was running. It names the running work and
 * makes explicit that switching does NOT stop it — the job keeps running, the
 * Experiments panel just won't be visible in Learn. Confirm applies the
 * switch; cancel discards it. Keyboard: Enter confirms, Escape cancels; focus
 * lands on Confirm so a keyboard user can act immediately.
 */
export function ModeSwitchDialog() {
  const colors = useThemeStore((s) => s.colors);
  const pending = useModeSwitchStore((s) => s.pending);
  const confirmPending = useModeSwitchStore((s) => s.confirmPending);
  const cancelPending = useModeSwitchStore((s) => s.cancelPending);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelPending();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        confirmPending();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending, cancelPending, confirmPending]);

  if (!pending) return null;

  const targetLabel = pending.target === 'research' ? 'Research' : 'Learn';

  const dialog = (
    <div
      role="presentation"
      onClick={cancelPending}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mode-switch-title"
        aria-describedby="mode-switch-body"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: '90vw',
          background: colors.bgPanel,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          padding: 20,
          fontFamily: "'Geist Sans', sans-serif",
          boxShadow: '0 12px 48px rgba(0,0,0,0.4)',
        }}
      >
        <div
          id="mode-switch-title"
          style={{ fontSize: 15, fontWeight: 600, color: colors.text, marginBottom: 8 }}
        >
          Switch to {targetLabel} mode?
        </div>
        <div
          id="mode-switch-body"
          style={{ fontSize: 13, lineHeight: 1.5, color: colors.textMuted, marginBottom: 18 }}
        >
          <strong style={{ color: colors.text }}>{pending.runningName}</strong> is running.
          Switching modes will <strong style={{ color: colors.text }}>not</strong> stop it — the
          run keeps going, the Experiments panel just won't be visible in {targetLabel}.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={cancelPending}
            style={{
              padding: '7px 14px',
              background: 'transparent',
              color: colors.textDim,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            Stay in {pending.target === 'research' ? 'Learn' : 'Research'}
          </button>
          <button
            ref={confirmRef}
            onClick={confirmPending}
            style={{
              padding: '7px 14px',
              background: colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            Switch to {targetLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
