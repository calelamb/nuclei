import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GraduationCap, FlaskConical, Check } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useWorkspaceStore, type WorkspaceMode } from '../../stores/workspaceStore';
import { useModeSwitchStore } from '../../stores/modeSwitchStore';

import { TYPOGRAPHY } from '../../styles/tokens';
import { Tooltip } from '../ui';
import { shortcutLabel } from '../../config/keybindings';
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
  const shadow = useThemeStore((s) => s.shadow);
  const mode = useWorkspaceStore((s) => s.mode);
  const requestSwitch = useModeSwitchStore((s) => s.requestSwitch);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const accent = mode === 'research' ? colors.modeResearch : colors.accent;
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
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // Move focus into the menu (onto the current mode) once it is mounted.
  useEffect(() => {
    if (!open || !menuPos) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    const current = Array.from(items ?? []).find((el) => el.getAttribute('aria-checked') === 'true');
    (current ?? items?.[0])?.focus();
  }, [open, menuPos]);

  const closeAndRefocus = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'Escape': e.preventDefault(); closeAndRefocus(); break;
      case 'ArrowDown': e.preventDefault(); focusAt(at + 1); break;
      case 'ArrowUp': e.preventDefault(); focusAt(at - 1); break;
      case 'Home': e.preventDefault(); focusAt(0); break;
      case 'End': e.preventDefault(); focusAt(items.length - 1); break;
      case 'Tab': setOpen(false); break;
      default: break;
    }
  };

  const pick = (target: WorkspaceMode) => {
    closeAndRefocus();
    requestSwitch(target);
  };

  const menu = menuPos && (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Switch workspace mode"
      onKeyDown={onMenuKeyDown}
      style={{
        position: 'fixed',
        left: menuPos.left,
        bottom: menuPos.bottom,
        minWidth: 180,
        background: colors.bgElevated,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        boxShadow: shadow.md,
        padding: 4,
        zIndex: 1000,
        fontFamily: TYPOGRAPHY.fontSans,
      }}
    >
      {(['learn', 'research'] as WorkspaceMode[]).map((m) => {
        const mMeta = MODE_META[m];
        const MIcon = mMeta.icon;
        const isCurrent = m === mode;
        const mAccent = m === 'research' ? colors.modeResearch : colors.accent;
        return (
          <button
            key={m}
            role="menuitemradio"
            aria-checked={isCurrent}
            onClick={() => pick(m)}
            className="nuclei-menu-item nuclei-menu-item--tint"
            style={{
              ...({ '--item-accent': mAccent } as Record<string, string>),
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
            } as React.CSSProperties}
          >
            <MIcon size={14} color={mAccent} strokeWidth={2} />
            <span style={{ flex: 1 }}>{m === 'research' ? 'Research workspace' : 'Learn quantum computing'}</span>
            {isCurrent && <Check size={14} color={mAccent} />}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <Tooltip label="Switch workspace mode" shortcut={shortcutLabel('switch-workspace')} placement="above">
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Switch workspace mode"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tour-target="mode-chip"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 20,
          padding: '0 8px',
          background: `${accent}1f`,
          border: `1px solid ${accent}`,
          borderRadius: 4,
          cursor: 'pointer',
          color: accent,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.5,
          fontFamily: TYPOGRAPHY.fontSans,
        }}
      >
        <Icon size={12} strokeWidth={2.2} />
        {meta.label}
      </button>
      </Tooltip>
      {open && createPortal(menu, document.body)}
    </>
  );
}
