import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { X, FileCode } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
import { getFileOps } from '../../App';
import { requestCloseTab } from '../../lib/tabClose';
import { arrowNavTarget } from '../../lib/arrowNav';
import { IconButton, Tooltip } from '../ui';
import { TYPOGRAPHY } from '../../styles/tokens';

const basename = (p: string) => p.split('/').pop() ?? p;
const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

export type StripOverflow = 'none' | 'start' | 'end' | 'both';

interface EditorTabStripProps {
  stripRef: RefObject<HTMLDivElement | null>;
  /** Called after every layout pass so the toolbar can re-measure its own width. */
  onMeasure: () => void;
  /** Reports whether the strip is wider than its box (drives the "all tabs" menu). */
  onOverflowing: (overflowing: boolean) => void;
}

/** The open-files tablist: roving tabindex, arrow/Home/End navigation, edge fades. */
export function EditorTabStrip({ stripRef, onMeasure, onOverflowing }: EditorTabStripProps) {
  const tabs = useProjectStore((s) => s.tabs);
  const activeTabPath = useProjectStore((s) => s.activeTabPath);
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const [overflow, setOverflow] = useState<StripOverflow>('none');
  const usingLegacy = tabs.length === 0;

  const measure = useCallback(() => {
    const strip = stripRef.current;
    if (strip) {
      const start = strip.scrollLeft > 1;
      const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
      setOverflow(start && end ? 'both' : start ? 'start' : end ? 'end' : 'none');
      onOverflowing(strip.scrollWidth > strip.clientWidth + 1);
    }
    onMeasure();
  }, [stripRef, onMeasure, onOverflowing]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- measures the live DOM (scroll/overflow), an external system
    measure();
    const strip = stripRef.current;
    if (typeof ResizeObserver === 'undefined' || !strip) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    if (strip.parentElement) observer.observe(strip.parentElement);
    return () => observer.disconnect();
  }, [measure, stripRef, tabs.length]);

  // Toolbar content changes the strip's width without resizing the bar.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- measures the live DOM; setState bails out when nothing changed
  useLayoutEffect(() => { measure(); });

  // Keep the active tab fully visible (scroll-padding on the strip clears the edge fades).
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !activeTabPath) return;
    const active = Array.from(strip.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (el) => el.dataset.tabPath === activeTabPath,
    );
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabPath, tabs.length, stripRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.has(e.key)) return;
    const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const next = arrowNavTarget(e.key, at, els.length);
    if (next === null) return;
    e.preventDefault();
    const target = els[next];
    target.focus();
    if (target.dataset.tabPath) setActiveTab(target.dataset.tabPath);
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Open files"
      data-overflow={overflow}
      className="nuclei-fade-x"
      onScroll={measure}
      onKeyDown={onKeyDown}
      style={{
        display: 'flex', alignItems: 'stretch', overflowX: 'auto', overflowY: 'hidden',
        minWidth: 0, flex: '1 1 0', scrollbarWidth: 'none', scrollPaddingInline: 28,
      }}
    >
      {usingLegacy ? <LegacyTab /> : tabs.map((t) => (
        <ProjectTab key={t.path} path={t.path} isDirty={t.isDirty} isActive={t.path === activeTabPath} />
      ))}
    </div>
  );
}

function ProjectTab({ path, isDirty, isActive }: { path: string; isDirty: boolean; isActive: boolean }) {
  const colors = useThemeStore((s) => s.colors);
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const name = basename(path);
  return (
    <div
      role="tab"
      data-tab-path={path}
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={() => setActiveTab(path)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab(path); }
        else if (e.key === 'Delete') { e.preventDefault(); requestCloseTab(path); }
      }}
      onAuxClick={(e) => {
        if (e.button === 1) { e.preventDefault(); requestCloseTab(path); }
      }}
      className="nuclei-file-tab"
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', height: '100%',
        background: isActive ? colors.bgEditor : 'transparent',
        borderBottom: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
        fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, color: isActive ? colors.text : colors.textDim,
        cursor: 'pointer', maxWidth: 220, flexShrink: 0, transition: 'background 120ms ease',
      }}
    >
      <FileCode size={14} style={{ color: isActive ? colors.accentText : colors.textDim, flexShrink: 0 }} />
      {isDirty && (
        <Tooltip label="Unsaved changes" placement="below">
          <span
            role="img"
            aria-label="Unsaved changes"
            style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: colors.warning, flexShrink: 0 }}
          />
        </Tooltip>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <IconButton
        size="sm"
        className="nuclei-tab-close"
        aria-label={`Close ${name}`}
        tabIndex={-1}
        tooltip={{ label: `Close ${name}`, placement: 'below' }}
        onClick={(e) => { e.stopPropagation(); requestCloseTab(path); }}
      >
        <X size={12} />
      </IconButton>
    </div>
  );
}

/** The single unsaved-buffer tab shown before any project file is open; renameable in place. */
function LegacyTab() {
  const colors = useThemeStore((s) => s.colors);
  const filePath = useEditorStore((s) => s.filePath);
  const isDirty = useEditorStore((s) => s.isDirty);
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);
  const name = filePath ? basename(filePath) : 'untitled.py';

  useEffect(() => {
    if (renaming) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [renaming]);

  const startRename = () => { setValue(name); setRenaming(true); };
  // `refocus`: the user finished with the keyboard (Enter/Escape), so the input's removal must not drop focus to <body>.
  const stopRename = (refocus = false) => {
    setRenaming(false);
    setValue('');
    if (refocus) requestAnimationFrame(() => tabRef.current?.focus());
  };
  const commit = async (refocus = false) => {
    const next = value.trim();
    if (!next || next === name) { stopRename(refocus); return; }
    const ops = getFileOps();
    const result = ops ? await ops.renameFile(next) : null;
    if (!result) { inputRef.current?.select(); return; }
    stopRename(refocus);
  };

  return (
    <div
      ref={tabRef}
      role="tab"
      aria-selected="true"
      tabIndex={0}
      aria-keyshortcuts="F2"
      onKeyDown={(e) => { if (e.key === 'F2' && !renaming) { e.preventDefault(); startRename(); } }}
      className="nuclei-file-tab"
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', height: '100%',
        backgroundColor: colors.bgEditor, borderBottom: `2px solid ${colors.accent}`,
        fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, color: colors.text, cursor: 'default', maxWidth: 260, minWidth: 0,
      }}
    >
      <FileCode size={14} style={{ color: colors.accentText, flexShrink: 0 }} />
      {isDirty && !renaming && (
        <Tooltip label="Unsaved changes" placement="below">
          <span role="img" aria-label="Unsaved changes" style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: colors.warning, flexShrink: 0 }} />
        </Tooltip>
      )}
      {renaming ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void commit(true); }
            else if (e.key === 'Escape') { e.preventDefault(); stopRename(true); }
            e.stopPropagation();
          }}
          onBlur={() => { void commit(); }}
          aria-label="Rename file"
          className="nuclei-bare-input"
          style={{
            background: colors.bgElevated, border: `1px solid ${colors.accent}`, borderRadius: 'var(--radius-xs)',
            color: colors.text, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, padding: '2px 6px', minWidth: 120,
          }}
        />
      ) : (
        <Tooltip label="Double-click or press F2 to rename" placement="below">
          <span
            onDoubleClick={startRename}
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text', userSelect: 'none' }}
          >
            {name}
          </span>
        </Tooltip>
      )}
    </div>
  );
}
