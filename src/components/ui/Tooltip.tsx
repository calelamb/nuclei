import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
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
const POINTER_FOCUS_WINDOW_MS = 600;
let lastPointerDownAt = Number.NEGATIVE_INFINITY;
let pointerListenerInstalled = false;

function trackPointerDown(): void {
  if (pointerListenerInstalled || typeof window === 'undefined') return;
  pointerListenerInstalled = true;
  window.addEventListener('pointerdown', () => { lastPointerDownAt = Date.now(); }, { capture: true, passive: true });
}

/**
 * Focus that lands right after a mouse press anywhere (a menu closing back onto its trigger)
 * is not keyboard focus and must not pop a tooltip over the thing just chosen.
 */
function focusFollowsPointer(): boolean {
  return Date.now() - lastPointerDownAt < POINTER_FOCUS_WINDOW_MS;
}

export function Tooltip({ label, shortcut, placement = 'above', children }: TooltipProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const id = useId();
  useEffect(trackPointerDown, []);
  const [pos, setPos] = useState<Position | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A click focuses the control right after mousedown; that focus is not keyboard focus
  // and must not re-arm the tooltip the click just dismissed.
  const pointerFocus = useRef(false);
  // After a click the tooltip stays shut until the pointer leaves: a click that re-renders
  // the trigger under the cursor makes the browser fire a fresh mouseenter.
  const suppressed = useRef(false);
  const tipRef = useRef<HTMLDivElement>(null);

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

  // Clamp the rendered tooltip into the viewport: its real width is only known after layout,
  // so measure at the natural position and nudge the DOM node (no extra render).
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!open || !pos || !tip) return;
    tip.style.left = `${pos.left}px`;
    const r = tip.getBoundingClientRect();
    if (r.width === 0) return;
    let dx = 0;
    if (r.right > window.innerWidth - EDGE) dx = window.innerWidth - EDGE - r.right;
    if (r.left + dx < EDGE) dx = EDGE - r.left;
    if (dx !== 0) tip.style.left = `${pos.left + dx}px`;
  }, [open, pos]);

  const show = () => {
    if (suppressed.current) return;
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
      onMouseLeave={() => { suppressed.current = false; hide(); }}
      onFocus={() => { if (!pointerFocus.current && !focusFollowsPointer()) show(); }}
      onBlur={() => hide(true)}
      onMouseDown={() => {
        suppressed.current = true;
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
          ref={tipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            transform: TRANSFORMS[pos.placement],
            zIndex: 6000,
            pointerEvents: 'none',
            display: 'flex', alignItems: 'center', gap: 8,
            width: 'max-content', maxWidth: 260, padding: '4px 8px',
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
