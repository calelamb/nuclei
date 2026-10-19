import { useModeSwitchStore } from '../../stores/modeSwitchStore';
import { useThemeStore } from '../../stores/themeStore';
import { Button, Dialog } from '../ui';

/**
 * PRD 11 Phase B — the in-flight-work confirm dialog.
 *
 * Rendered once at the layout root. Appears only when `requestSwitch` staged
 * a switch while a sweep/campaign was running. It names the running work and
 * makes explicit that switching does NOT stop it — the job keeps running, the
 * Experiments panel just won't be visible in Learn. Confirm applies the
 * switch; cancel (Escape, scrim) discards it. Focus lands on Confirm so a
 * keyboard user can act immediately, and returns to the opener afterwards.
 */
export function ModeSwitchDialog() {
  const colors = useThemeStore((s) => s.colors);
  const pending = useModeSwitchStore((s) => s.pending);
  const confirmPending = useModeSwitchStore((s) => s.confirmPending);
  const cancelPending = useModeSwitchStore((s) => s.cancelPending);

  if (!pending) return null;
  const targetLabel = pending.target === 'research' ? 'Research' : 'Learn';

  return (
    <Dialog
      title={`Switch to ${targetLabel} mode?`}
      width={420}
      onClose={cancelPending}
      hideClose
      role="alertdialog"
      initialFocus="[data-confirm]"
      footer={(
        <>
          <Button onClick={cancelPending}>Stay in {pending.target === 'research' ? 'Learn' : 'Research'}</Button>
          <Button variant="primary" data-confirm onClick={confirmPending}>Switch to {targetLabel}</Button>
        </>
      )}
    >
      <span style={{ fontSize: 13, lineHeight: 1.5 }}>
        <strong style={{ color: colors.text }}>{pending.runningName}</strong> is running.
        Switching modes will <strong style={{ color: colors.text }}>not</strong> stop it — the
        run keeps going, the {pending.panelName ?? 'Experiments panel'} just won't be visible in {targetLabel}.
      </span>
    </Dialog>
  );
}
