import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GraduationCap, FlaskConical, Check } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useWorkspaceStore, type WorkspaceMode } from '../../stores/workspaceStore';
import { useModeSwitchStore } from '../../stores/modeSwitchStore';

/**
 * PRD 11 Phase B — the mode chip.
 *
 * Far-left of the status bar; the always-visible answer to "which mode am I
 * in" (text label + accent colour, never colour alone — D6). Click opens a
 * small switch menu (Learn / Research). Switching routes through
 * `modeSwitchStore.requestSwitch`, which confirms first if a sweep/campaign
 * is running (and never cancels it).
 *
 * The accent is Dirac purple for Research, quantum teal for Learn — reusing
 * the existing palette tokens rather than inventing colours.
 */

const MODE_META: Record<WorkspaceMode, { label: string; icon: typeof GraduationCap }> = {
  learn: { label: 'LEARN', icon: GraduationCap },
  research: { label: 'RESEARCH', icon: FlaskConical },
};

export function ModeChip() {
  const colors = useThemeStore((s) => s.colors);
  const mode = useWorkspaceStore((s) => s.mode);
  const requestSwitch = useModeSwitchStore((s) => s.requestSwitch);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const accent = mode === 'research' ? colors.dirac : colors.accent;
  const meta = MODE_META[mode];
  const Icon = meta.icon;

  useLayoutEffect(() => {
    if (!open) return;
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    // Anchored above the chip (status bar sits at the window bottom).
    setMenuPos({ left: r.left, bottom: window.innerHeight - r.top + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (target: WorkspaceMode) => {
    setOpen(false);
    requestSwitch(target);
  };

  const menu = menuPos && (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Switch workspace mode"
      style={{
        position: 'fixed',
        left: menuPos.left,
        bottom: menuPos.bottom,
        minWidth: 180,
        background: colors.bgElevated,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        boxShadow: '0 6px 24px rgba(0,0,0,0.28)',
        padding: 4,
        zIndex: 1000,
        fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      {(['learn', 'research'] as WorkspaceMode[]).map((m) => {
        const mMeta = MODE_META[m];
        const MIcon = mMeta.icon;
        const isCurrent = m === mode;
        const mAccent = m === 'research' ? colors.dirac : colors.accent;
        return (
          <button
            key={m}
            role="menuitemradio"
            aria-checked={isCurrent}
            onClick={() => pick(m)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 10px',
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              color: colors.text,
              fontSize: 12,
              textAlign: 'left',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `${mAccent}18`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <MIcon size={13} color={mAccent} strokeWidth={2} />
            <span style={{ flex: 1 }}>{m === 'research' ? 'Research workspace' : 'Learn quantum computing'}</span>
            {isCurrent && <Check size={13} color={mAccent} />}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        title="Switch workspace mode"
        aria-label="Switch workspace mode"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tour-target="mode-chip"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 16,
          padding: '0 7px',
          background: `${accent}1f`,
          border: `1px solid ${accent}`,
          borderRadius: 4,
          cursor: 'pointer',
          color: accent,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.5,
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        <Icon size={11} strokeWidth={2.2} />
        {meta.label}
      </button>
      {open && createPortal(menu, document.body)}
    </>
  );
}
