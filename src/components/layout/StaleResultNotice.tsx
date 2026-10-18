import { useThemeStore } from '../../stores/themeStore';
import { shortcutLabel } from '../../config/keybindings';
import { TYPOGRAPHY } from '../../styles/tokens';
import { Tooltip } from '../ui/Tooltip';

/** Opacity of results that no longer match the code (still legible, clearly not current). */
export const STALE_RESULT_OPACITY = 0.5;

interface StaleResultNoticeProps {
  /** Replaces the default "From last run · code changed · Run ⌘↵" copy. */
  label?: string;
  /** Longer explanation shown in the shared tooltip. */
  tooltip?: string;
  /** Makes the pill a button (for example "jump to the line with the error"). */
  onActivate?: () => void;
  /** Sit inline inside a header row (shrinks with ellipsis) instead of taking a row of its own. */
  inline?: boolean;
}

/**
 * Pill at the top of a results panel when what is shown no longer matches the code. By default it
 * sits in the flow, above the cards, so it never covers what it describes; `overlay` floats it
 * over a diagram so appearing does not move anything.
 */
export function StaleResultNotice({ label, tooltip, onActivate, inline = false }: StaleResultNoticeProps = {}) {
  const colors = useThemeStore((s) => s.colors);
  const run = shortcutLabel('run');
  const text = label ?? `From last run · code changed${run ? ` · Run ${run}` : ''}`;
  const pillStyle = {
    maxWidth: '100%', padding: '3px 10px', borderRadius: 999,
    background: colors.bgElevated, border: `1px solid ${colors.border}`, color: colors.textMuted,
    fontFamily: TYPOGRAPHY.fontSans, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  } as const;
  const pill = onActivate ? (
    <button type="button" onClick={onActivate} style={{ ...pillStyle, cursor: 'pointer' }}>{text}</button>
  ) : (
    <div role="status" style={pillStyle}>{text}</div>
  );
  const wrapStyle = inline
    ? { display: 'flex', minWidth: 0, flex: '0 1 auto' } as const
    : { flex: '0 0 auto', display: 'flex', justifyContent: 'center', padding: '6px 8px 0', minWidth: 0 } as const;
  return (
    <div data-testid="stale-result-notice" style={wrapStyle}>
      <span style={{ display: 'inline-flex', maxWidth: '100%', minWidth: 0 }}>
        {tooltip ? <Tooltip label={tooltip} placement="below">{pill}</Tooltip> : pill}
      </span>
    </div>
  );
}
