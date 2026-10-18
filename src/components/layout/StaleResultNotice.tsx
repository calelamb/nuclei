import { useThemeStore } from '../../stores/themeStore';
import { shortcutLabel } from '../../config/keybindings';
import { TYPOGRAPHY } from '../../styles/tokens';

/** Opacity of results that no longer match the code (still legible, clearly not current). */
export const STALE_RESULT_OPACITY = 0.5;

/**
 * Pill at the top of a results panel when the code has changed since the run. It sits in the
 * flow, above the cards, so it never covers what it describes.
 */
export function StaleResultNotice() {
  const colors = useThemeStore((s) => s.colors);
  const run = shortcutLabel('run');
  return (
    <div data-testid="stale-result-notice" style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'center', padding: '6px 8px 0', minWidth: 0 }}>
      <div
        role="status"
        style={{
          maxWidth: '100%', padding: '3px 10px', borderRadius: 999,
          background: colors.bgElevated, border: `1px solid ${colors.border}`, color: colors.textMuted,
          fontFamily: TYPOGRAPHY.fontSans, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        From last run · code changed{run ? ` · Run ${run}` : ''}
      </div>
    </div>
  );
}
