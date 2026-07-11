import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';

/**
 * PRD 09 Phase D (D4) / Risk 1 — hardware sweep guard.
 *
 * Warns with `points × shots` before any sweep against a non-simulator
 * provider, and above 10 hardware points requires typing the experiment's
 * name to confirm (real hardware quota burns real money/time).
 */
export const HARDWARE_SWEEP_CONFIRM_THRESHOLD = 10;

interface HardwareSweepGuardProps {
  experimentName: string;
  backendLabel: string;
  pointCount: number;
  shots: number;
  onConfirm(): void;
  onCancel(): void;
}

export function HardwareSweepGuard({
  experimentName,
  backendLabel,
  pointCount,
  shots,
  onConfirm,
  onCancel,
}: HardwareSweepGuardProps) {
  const colors = useThemeStore((s) => s.colors);
  const requiresTyping = pointCount > HARDWARE_SWEEP_CONFIRM_THRESHOLD;
  const [typed, setTyped] = useState('');
  const canConfirm = !requiresTyping || typed === experimentName;
  const totalShots = pointCount * shots;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Confirm hardware sweep"
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8,
          padding: 20, width: 380, maxWidth: '90%',
          fontFamily: "'Geist Sans', sans-serif",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ color: colors.warning, fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
          Confirm hardware sweep
        </div>
        <div style={{ color: colors.text, fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
          This will submit <strong>{pointCount}</strong> point{pointCount === 1 ? '' : 's'} to{' '}
          <strong>{backendLabel}</strong> at <strong>{shots}</strong> shots each —{' '}
          <strong>{totalShots.toLocaleString()}</strong> total shots on real hardware.
        </div>
        {requiresTyping && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', color: colors.textMuted, fontSize: 11, marginBottom: 6 }}>
              Type the experiment name (<code>{experimentName}</code>) to confirm:
            </label>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={experimentName}
              style={{
                width: '100%', padding: '6px 10px', fontSize: 12,
                fontFamily: "'Fira Code', monospace",
                background: colors.bgPanel, border: `1px solid ${colors.border}`,
                borderRadius: 4, color: colors.text, outline: 'none',
              }}
            />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 12px', background: 'transparent', color: colors.textDim,
              border: `1px solid ${colors.border}`, borderRadius: 6, cursor: 'pointer', fontSize: 12,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            style={{
              padding: '6px 12px',
              background: canConfirm ? colors.warning : colors.border,
              color: canConfirm ? '#1a1a1a' : colors.textDim,
              border: 'none', borderRadius: 6,
              cursor: canConfirm ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600,
            }}
          >
            Submit to hardware
          </button>
        </div>
      </div>
    </div>
  );
}
