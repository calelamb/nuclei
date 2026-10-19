import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useThemeStore } from '../../stores/themeStore';
import { TYPOGRAPHY } from '../../styles/tokens';
import { anchorTooltip, nudgeIntoView, TOOLTIP_TRANSFORMS, type TooltipPosition, type TooltipSide } from './tooltipPlacement';
import { claimTooltip, releaseTooltip, tooltipIsWarm } from './tooltipSingleton';

export const TOOLTIP_OPEN_DELAY_MS = 400;
export const TOOLTIP_CLOSE_DELAY_MS = 100;

export interface TooltipProps {
  label: string;
  /** Shortcut in glyph form (use `shortcutLabel`); rendered as a kbd chip. */
  shortcut?: string;
  /** Preferred side; above/below flip when there is no room, left/right follow the pointer along a tall trigger. Default: above. */
  placement?: TooltipSide;
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
  const [pos, setPos] = useState<TooltipPosition | null>(null);
  const pointerY = useRef<number | null>(null);
  const [open, setOpenState] = useState(false);
  // Mirrors `open` synchronously: a blur that fires before React re-renders must still see the tip as open.
  const openRef = useRef(false);
  const setOpen = useCallback((value: boolean) => { openRef.current = value; setOpenState(value); }, []);
  // Whether the pointer rests on, or keyboard focus sits in, the trigger. A delayed open re-checks this.
  const engaged = useRef({ hover: false, focus: false });
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
    setPos(anchorTooltip(target.getBoundingClientRect(), placement, { width: window.innerWidth, height: window.innerHeight }, pointerY.current));
  }, [placement]);

  // Clamp the rendered tooltip into the viewport: its real size is only known after layout,
  // so measure at the natural position and nudge the DOM node (no extra render).
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!open || !pos || !tip) return;
    tip.style.left = `${pos.left}px`;
    tip.style.top = `${pos.top}px`;
    const r = tip.getBoundingClientRect();
    if (r.width === 0) return;
    const { dx, dy } = nudgeIntoView(r, { width: window.innerWidth, height: window.innerHeight });
    if (dx !== 0) tip.style.left = `${pos.left + dx}px`;
    if (dy !== 0) tip.style.top = `${pos.top + dy}px`;
  }, [open, pos]);

  // One tooltip at a time: opening claims the slot and closes whichever tip was showing.
  const closeNow = useCallback(() => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(false);
  }, [setOpen]);
  useEffect(() => {
    if (!open) return undefined;
    claimTooltip(closeNow);
    return () => releaseTooltip(closeNow);
  }, [open, closeNow]);

  // A trigger that turns disabled while the tip is up (focus just fell off it) must not leave the tip stranded.
  useEffect(() => {
    const target = wrapRef.current?.firstElementChild;
    if (!open || !target || typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => { if (target.hasAttribute('disabled')) closeNow(); });
    observer.observe(target, { attributes: true, attributeFilter: ['disabled'] });
    return () => observer.disconnect();
  }, [open, closeNow]);

  const show = () => {
    if (suppressed.current) return;
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (openRef.current || openTimer.current) return;
    // Moving along a row of icons (or while another tip is up) opens the next one straight away.
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      if (!engaged.current.hover && !engaged.current.focus) return;
      measure();
      setOpen(true);
    }, tooltipIsWarm() ? 0 : TOOLTIP_OPEN_DELAY_MS);
  };

  const hide = (immediate = false) => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (!openRef.current) return;
    if (immediate) { setOpen(false); return; }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setOpen(false); }, TOOLTIP_CLOSE_DELAY_MS);
  };

  const trigger = cloneElement(children, { 'aria-describedby': open ? id : undefined });

  return (
    <span
      ref={wrapRef}
      style={{ display: 'contents' }}
      onMouseEnter={(e) => { engaged.current.hover = true; pointerY.current = e.clientY; show(); }}
      onMouseMove={(e) => { if (!open) pointerY.current = e.clientY; }}
      onMouseLeave={() => { engaged.current.hover = false; suppressed.current = false; pointerY.current = null; hide(); }}
      onFocus={() => { if (!pointerFocus.current && !focusFollowsPointer()) { engaged.current.focus = true; show(); } }}
      onBlur={() => { engaged.current.focus = false; hide(true); }}
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
            transform: TOOLTIP_TRANSFORMS[pos.placement],
            zIndex: 6000,
            pointerEvents: 'none',
            display: 'flex', alignItems: 'center', gap: 8,
            width: 'max-content', maxWidth: 260, padding: '4px 8px',
            background: colors.bgElevated, color: colors.text,
            border: `1px solid ${colors.borderStrong}`, borderRadius: 6, boxShadow: shadow.md,
            fontSize: 12, lineHeight: 1.3, fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          {/* pre-line: a label with newlines (a list of warnings) reads as one line per item. */}
          <span style={{ whiteSpace: 'pre-line' }}>{label}</span>
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
