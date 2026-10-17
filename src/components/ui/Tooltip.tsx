import { cloneElement, useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useThemeStore } from '../../stores/themeStore';
import { TYPOGRAPHY } from '../../styles/tokens';

export const TOOLTIP_OPEN_DELAY_MS = 400;
export const TOOLTIP_CLOSE_DELAY_MS = 100;
const GAP = 6;
const EDGE = 8;
const TRANSFORMS = {
  above: 'translate(-50%, -100%)',
  below: 'translate(-50%, 0)',
  right: 'translate(0, -50%)',
} as const;

interface Position { left: number; top: number; placement: 'above' | 'below' | 'right' }

export interface TooltipProps {
  label: string;
  /** Shortcut in glyph form (use `shortcutLabel`); rendered as a kbd chip. */
  shortcut?: string;
  /** Preferred side; flips when there is no room. Default: above. */
  placement?: 'above' | 'below' | 'right';
  /** The single trigger element. It keeps its own handlers; the tooltip adds aria-describedby. */
  children: ReactElement<Record<string, unknown>>;
}

/**
 * One tooltip for the app: 400ms open delay (no flicker on a pass-over), 100ms
 * close, keyboard focus opens it, Escape dismisses it, and shortcuts are shown
 * as kbd chips in one glyph notation. Replaces native `title` for icon-only and
 * shortcut-bearing controls.
 */
export function Tooltip({ label, shortcut, placement = 'above', children }: TooltipProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const id = useId();
  const [pos, setPos] = useState<Position | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A click focuses the control right after mousedown; that focus is not keyboard focus
  // and must not re-arm the tooltip the click just dismissed.
  const pointerFocus = useRef(false);

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const measure = useCallback(() => {
    const target = wrapRef.current?.firstElementChild;
    if (!target) return;
    const r = target.getBoundingClientRect();
    if (placement === 'right') {
      setPos({ left: r.right + GAP, top: r.top + r.height / 2, placement: 'right' });
      return;
    }
    const wantBelow = placement === 'below' || r.top < 40;
    setPos({
      left: Math.min(Math.max(r.left + r.width / 2, EDGE + 60), window.innerWidth - EDGE - 60),
      top: wantBelow ? r.bottom + GAP : r.top - GAP,
      placement: wantBelow ? 'below' : 'above',
    });
  }, [placement]);

  const show = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (open || openTimer.current) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      measure();
      setOpen(true);
    }, TOOLTIP_OPEN_DELAY_MS);
  };

  const hide = (immediate = false) => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (!open) return;
    if (immediate) { setOpen(false); return; }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setOpen(false); }, TOOLTIP_CLOSE_DELAY_MS);
  };

  const trigger = cloneElement(children, { 'aria-describedby': open ? id : undefined });

  return (
    <span
      ref={wrapRef}
      style={{ display: 'contents' }}
      onMouseEnter={show}
      onMouseLeave={() => hide()}
      onFocus={() => { if (!pointerFocus.current) show(); }}
      onBlur={() => hide(true)}
      onMouseDown={() => {
        hide(true);
        pointerFocus.current = true;
        setTimeout(() => { pointerFocus.current = false; }, 0);
      }}
      onKeyDown={(e) => { if (e.key === 'Escape') hide(true); }}
    >
      {trigger}
      {open && pos && createPortal(
        <div
          id={id}
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            transform: TRANSFORMS[pos.placement],
            zIndex: 6000,
            pointerEvents: 'none',
            display: 'flex', alignItems: 'center', gap: 8,
            maxWidth: 260, padding: '5px 8px',
            background: colors.bgElevated, color: colors.text,
            border: `1px solid ${colors.borderStrong}`, borderRadius: 6, boxShadow: shadow.md,
            fontSize: 12, lineHeight: 1.3, fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          <span>{label}</span>
          {shortcut && (
            <kbd style={{
              fontFamily: TYPOGRAPHY.fontMono, fontSize: 11, color: colors.textMuted,
              background: colors.bgPanel, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '0 5px',
            }}
            >
              {shortcut}
            </kbd>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}
