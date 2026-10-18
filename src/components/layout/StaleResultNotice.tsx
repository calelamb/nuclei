import { useThemeStore } from '../../stores/themeStore';
import { shortcutLabel } from '../../config/keybindings';
import { TYPOGRAPHY } from '../../styles/tokens';

/** Opacity of results that no longer match the code (still legible, clearly not current). */
export const STALE_RESULT_OPACITY = 0.5;

/**
 * Pill laid over the top of a results panel when the code has changed since the run.
 * Absolutely positioned so appearing or clearing it never moves the panel beneath.
 */
export function StaleResultNotice() {
  const colors = useThemeStore((s) => s.colors);
  const run = shortcutLabel('run');
  return (
    <div
      role="status"
      data-testid="stale-result-notice"
      style={{
        position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 2,
        maxWidth: 'calc(100% - 16px)', padding: '3px 10px', borderRadius: 999,
        background: colors.bgElevated, border: `1px solid ${colors.border}`, color: colors.textMuted,
        fontFamily: TYPOGRAPHY.fontSans, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        pointerEvents: 'none',
      }}
    >
      From last run · code changed{run ? ` · Run ${run}` : ''}
    </div>
  );
}
