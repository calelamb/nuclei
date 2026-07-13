import { useState, useRef, useLayoutEffect, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical, EyeOff, RotateCcw, HelpCircle, type LucideIcon } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';

/**
 * PRD 11 Phase C — the shared panel header.
 *
 * One header chrome for every panel: a title (optional icon + context), an
 * actions slot, and an overflow menu (Hide panel / Reset layout / Help→docs).
 * PRD 10 Phase D's QEC panels register into the panel registry and inherit
 * THIS header instead of hand-rolling their own — which is why Phase C gates
 * that work.
 *
 * Style matches the existing hand-rolled headers (RunDetail, BottomPanel tabs):
 * a slim bar with a bottom border, uppercase-free 13px title, right-aligned
 * actions. No new dependencies — the overflow menu reuses the app's portal
 * dropdown pattern.
 */
export interface PanelHeaderProps {
  title: string;
  /** Secondary context after the title, e.g. the active experiment name. */
  context?: string;
  icon?: LucideIcon;
  /** Leading element before the title (e.g. a back button). */
  leading?: ReactNode;
  /** Right-aligned action buttons, before the overflow menu. */
  actions?: ReactNode;
  /** Overflow: hide this panel (wired to layoutStore.setPanelOverride). */
  onHide?: () => void;
  /** Overflow: reset the panel layout (layoutStore.resetPanelOverrides). */
  onResetLayout?: () => void;
  /** Overflow: deep-link to the relevant docs page. */
  helpHref?: string;
}

export function PanelHeader({
  title,
  context,
  icon: Icon,
  leading,
  actions,
  onHide,
  onResetLayout,
  helpHref,
}: PanelHeaderProps) {
  const colors = useThemeStore((s) => s.colors);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const overflowRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasOverflow = Boolean(onHide || onResetLayout || helpHref);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const btn = overflowRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !overflowRef.current?.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const runAndClose = (fn?: () => void) => {
    setMenuOpen(false);
    fn?.();
  };

  const menuItem = (label: string, MIcon: LucideIcon, onClick: () => void) => (
    <button
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '7px 10px', background: 'transparent', border: 'none', borderRadius: 6,
        cursor: 'pointer', color: colors.text, fontSize: 12, textAlign: 'left',
        fontFamily: "'Geist Sans', sans-serif",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgElevated; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <MIcon size={13} color={colors.textDim} />
      {label}
    </button>
  );

  const menu = menuPos && (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${title} panel options`}
      style={{
        position: 'fixed', top: menuPos.top, right: menuPos.right, minWidth: 172,
        background: colors.bgElevated, border: `1px solid ${colors.border}`, borderRadius: 8,
        boxShadow: '0 6px 24px rgba(0,0,0,0.28)', padding: 4, zIndex: 1000,
      }}
    >
      {onHide && menuItem('Hide panel', EyeOff, () => runAndClose(onHide))}
      {onResetLayout && menuItem('Reset layout', RotateCcw, () => runAndClose(onResetLayout))}
      {helpHref &&
        menuItem('Help', HelpCircle, () =>
          runAndClose(() => window.open(helpHref, '_blank', 'noopener,noreferrer')),
        )}
    </div>
  );

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        padding: '10px 12px', borderBottom: `1px solid ${colors.border}`,
        background: colors.bg,
      }}
    >
      {leading}
      {Icon && <Icon size={14} color={colors.textDim} />}
      <span
        style={{
          fontSize: 13, fontWeight: 600, color: colors.text,
          fontFamily: "'Geist Sans', sans-serif",
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
      {context && (
        <span
          style={{
            fontSize: 11, color: colors.textDim, fontFamily: "'Fira Code', monospace",
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {context}
        </span>
      )}
      <div style={{ flex: 1 }} />
      {actions}
      {hasOverflow && (
        <button
          ref={overflowRef}
          onClick={() => setMenuOpen((o) => !o)}
          title="Panel options"
          aria-label="Panel options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, background: 'transparent', border: 'none',
            borderRadius: 6, cursor: 'pointer', color: colors.textDim,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
        >
          <MoreVertical size={15} />
        </button>
      )}
      {menuOpen && createPortal(menu, document.body)}
    </div>
  );
}
