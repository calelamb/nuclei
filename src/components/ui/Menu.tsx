import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type ReactNode, type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { arrowNavTarget } from '../../lib/arrowNav';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { cx } from './cx';
import { computeMenuPosition, type MenuPlacement, type MenuPosition } from './menuPosition';

export interface MenuItemEntry {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Right-aligned secondary text (extension, shortcut). */
  hint?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  title?: string;
  /** Present = a checkable item (menuitemradio). */
  checked?: boolean;
  tone?: 'default' | 'danger';
  /** Keep the menu open after selecting (e.g. toggles). */
  keepOpen?: boolean;
  /** Children make this a disclosure: Right/Left expand and collapse it. */
  items?: MenuItemEntry[];
}
export interface MenuHeadingEntry { id: string; heading: string }
export interface MenuSeparatorEntry { id: string; separator: true }
export type MenuEntry = MenuItemEntry | MenuHeadingEntry | MenuSeparatorEntry;

/** Spread onto the trigger element; wires aria, click and the ArrowDown shortcut. */
export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls'?: string;
}

export interface MenuProps {
  /** Accessible name of the menu. */
  label: string;
  entries: ReadonlyArray<MenuEntry>;
  trigger: (props: MenuTriggerProps) => ReactNode;
  placement?: MenuPlacement;
  minWidth?: number;
  /** A status line under the items (e.g. "Copied"); announced politely. */
  notice?: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

const isItem = (e: MenuEntry): e is MenuItemEntry => 'label' in e;

interface Row { entry: MenuItemEntry; depth: number }

/**
 * The one menu: a real keyboard citizen. The trigger gets aria-haspopup and
 * aria-expanded; opening focuses the first item; Up/Down/Home/End rove (skipping
 * disabled items); Right/Left expand and collapse disclosures; Escape closes and
 * returns focus to the trigger; Tab closes. Portaled and flipped/clamped so it is
 * never clipped by an overflow:hidden toolbar or the viewport edge.
 */
export function Menu({ label, entries, trigger, placement = 'bottom-start', minWidth = 200, notice, onOpenChange }: MenuProps) {
  const [open, setOpenState] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [keyboardNav, setKeyboardNav] = useState(false);
  const menuId = useId();

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) { setPos(null); setExpanded(new Set()); setKeyboardNav(false); }
    onOpenChange?.(next);
  }, [onOpenChange]);

  const hasCheckable = entries.some((e) => isItem(e) && e.checked !== undefined);
  const rows = useMemo(() => {
    const out: Array<Row | MenuHeadingEntry | MenuSeparatorEntry> = [];
    for (const e of entries) {
      if (!isItem(e)) { out.push(e); continue; }
      out.push({ entry: e, depth: 0 });
      if (e.items && expanded.has(e.id)) for (const child of e.items) out.push({ entry: child, depth: 1 });
    }
    return out;
  }, [entries, expanded]);

  const focusables = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? []);

  const closeAndRefocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, [setOpen]);

  // Position once the real menu size is known; hidden until then so it never flashes at 0,0.
  useLayoutEffect(() => {
    if (!open) return;
    const t = triggerRef.current;
    const m = menuRef.current;
    if (!t || !m) return;
    const r = t.getBoundingClientRect();
    const next = computeMenuPosition(
      { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      { width: m.offsetWidth, height: m.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
      placement,
    );
    setPos((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight ? prev : next));
  }, [open, rows, placement, notice]);

  // Focus: a requested row after an expand, else the first item once per open. A hidden
  // (not yet positioned) menu cannot take focus, so wait for `pos`.
  const focusedOnOpen = useRef(false);
  useEffect(() => {
    if (!open) { focusedOnOpen.current = false; return; }
    if (!pos) return;
    const items = focusables();
    const wanted = pendingFocus.current;
    if (wanted) {
      (items.find((el) => el.dataset.menuId === wanted) ?? items[0])?.focus();
      pendingFocus.current = null;
      return;
    }
    if (!focusedOnOpen.current) {
      items[0]?.focus();
      focusedOnOpen.current = true;
    }
  }, [open, pos, rows]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open, setOpen]);

  const toggleExpanded = (id: string, on: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const select = (item: MenuItemEntry) => {
    if (item.disabled) return;
    if (item.items) {
      const on = !expanded.has(item.id);
      toggleExpanded(item.id, on);
      pendingFocus.current = item.id;
      return;
    }
    if (item.keepOpen) { item.onSelect?.(); return; }
    closeAndRefocus();
    item.onSelect?.();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    setKeyboardNav(true);
    const items = focusables();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const focused = items[at];
    const id = focused?.dataset.menuId;
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeAndRefocus();
        return;
      case 'Tab':
        setOpen(false);
        triggerRef.current?.focus();
        return;
      case 'ArrowRight': {
        if (!id || focused?.getAttribute('aria-expanded') === null) return;
        e.preventDefault();
        if (focused.getAttribute('aria-expanded') === 'false') {
          toggleExpanded(id, true);
          const first = entries.find((x) => isItem(x) && x.id === id) as MenuItemEntry | undefined;
          pendingFocus.current = first?.items?.find((c) => !c.disabled)?.id ?? id;
        } else {
          items[at + 1]?.focus();
        }
        return;
      }
      case 'ArrowLeft': {
        if (!id) return;
        const parent = entries.find((x) => isItem(x) && x.items?.some((c) => c.id === id)) as MenuItemEntry | undefined;
        if (parent) {
          e.preventDefault();
          toggleExpanded(parent.id, false);
          pendingFocus.current = parent.id;
        } else if (focused?.getAttribute('aria-expanded') === 'true') {
          e.preventDefault();
          toggleExpanded(id, false);
        }
        return;
      }
      case 'ArrowDown': case 'ArrowUp': case 'Home': case 'End': {
        const next = arrowNavTarget(e.key, at < 0 ? (e.key === 'ArrowUp' ? 0 : -1) : at, items.length);
        if (next === null) return;
        e.preventDefault();
        items[next]?.focus();
        return;
      }
      default:
    }
  };

  const triggerProps: MenuTriggerProps = {
    ref: triggerRef,
    onClick: () => setOpen(!open),
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') setKeyboardNav(true);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) setOpen(true);
      }
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
  };

  const menu = open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={label}
      className="nuclei-menu"
      data-modality={keyboardNav ? 'keyboard' : 'pointer'}
      onKeyDown={onMenuKeyDown}
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        minWidth,
        maxHeight: pos?.maxHeight,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {rows.map((row) => {
        if ('heading' in row) return <div key={row.id} className="nuclei-menu__heading" role="presentation">{row.heading}</div>;
        if ('separator' in row) return <div key={row.id} className="nuclei-menu__separator" role="separator" />;
        const { entry, depth } = row;
        const checkable = entry.checked !== undefined;
        const isParent = Boolean(entry.items);
        return (
          <button
            key={entry.id}
            type="button"
            role={checkable ? 'menuitemradio' : 'menuitem'}
            aria-checked={checkable ? entry.checked : undefined}
            aria-haspopup={isParent ? 'menu' : undefined}
            aria-expanded={isParent ? expanded.has(entry.id) : undefined}
            data-menu-id={entry.id}
            disabled={entry.disabled}
            title={entry.title}
            tabIndex={-1}
            className={cx('nuclei-menu-item', 'nuclei-menu__item', entry.tone === 'danger' && 'nuclei-menu__item--danger')}
            style={depth > 0 ? { paddingLeft: 'calc(var(--space-3) + var(--space-4))' } : undefined}
            onClick={() => select(entry)}
            onPointerMove={(e) => {
              if (e.currentTarget !== document.activeElement && !entry.disabled) e.currentTarget.focus({ preventScroll: true });
              if (keyboardNav) setKeyboardNav(false);
            }}
          >
            {hasCheckable && (
              <span className="nuclei-menu__slot" aria-hidden="true">
                {entry.checked && <Check size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}
              </span>
            )}
            {entry.icon && <span className="nuclei-menu__icon" aria-hidden="true">{entry.icon}</span>}
            <span className="nuclei-menu__label">{entry.label}</span>
            {entry.hint && <span className="nuclei-menu__hint">{entry.hint}</span>}
            {isParent && (expanded.has(entry.id)
              ? <ChevronDown size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
              : <ChevronRight size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />)}
          </button>
        );
      })}
      {notice && <div role="status" className="nuclei-menu__notice">{notice}</div>}
    </div>
  ) : null;

  return (
    <>
      {trigger(triggerProps)}
      {menu && createPortal(menu, document.body)}
    </>
  );
}
