import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useThemeStore } from '../../stores/themeStore';
import { X, FileCode, Play, Loader2, Rocket, ChevronDown } from 'lucide-react';
import { getExecute, getFileOps } from '../../App';
import { requestCloseTab } from '../../lib/tabClose';
import { FrameworkSelector } from './FrameworkSelector';
import { useHardwareStore } from '../../stores/hardwareStore';
import { tabBarDensity, type TabBarDensity } from './tabBarLayout';

const basename = (p: string) => p.split('/').pop() ?? p;

export function EditorTabs() {
  const tabs = useProjectStore((s) => s.tabs);
  const activeTabPath = useProjectStore((s) => s.activeTabPath);
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const legacyFilePath = useEditorStore((s) => s.filePath);
  const legacyIsDirty = useEditorStore((s) => s.isDirty);
  const kernelReady = useEditorStore((s) => s.kernelReady);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  const usingLegacy = tabs.length === 0;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const overflowBtnRef = useRef<HTMLButtonElement>(null);
  const [density, setDensity] = useState<TabBarDensity>('full');
  const compact = density !== 'full';
  const tight = density === 'tight';
  const [overflowing, setOverflowing] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowPos, setOverflowPos] = useState<{ top: number; right: number } | null>(null);
  const legacyName = legacyFilePath ? basename(legacyFilePath) : 'untitled.py';

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const measure = useCallback(() => {
    const bar = barRef.current;
    const strip = stripRef.current;
    if (bar) setDensity(tabBarDensity(bar.clientWidth));
    if (strip) setOverflowing(strip.scrollWidth > strip.clientWidth + 1);
  }, []);

  useEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined' || !barRef.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(barRef.current);
    if (stripRef.current) observer.observe(stripRef.current);
    return () => observer.disconnect();
  }, [measure, tabs.length]);

  // Toolbar content (kernel state, framework chip) changes the strip's width
  // without resizing the bar, so re-measure after every render; setState
  // bails out when nothing changed.
  useLayoutEffect(() => { measure(); });

  // Keep the active tab visible when it changes or the strip is narrow.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !activeTabPath) return;
    const active = Array.from(strip.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (el) => el.dataset.tabPath === activeTabPath,
    );
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabPath, tabs.length]);

  useEffect(() => {
    if (!overflowOpen) return;
    const btn = overflowBtnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      setOverflowPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (btn?.contains(target) || target.closest('[data-tab-overflow-menu]')) return;
      setOverflowOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOverflowOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [overflowOpen]);

  const canRun = kernelReady && !isRunning;
  const handleRun = () => {
    const e = getExecute();
    if (e) e();
  };
  const runLabel = isRunning ? 'Running…' : !kernelReady ? (compact ? 'Loading…' : 'Loading kernel…') : 'Run';
  const runTitle = isRunning
    ? 'Simulation running'
    : !kernelReady
      ? 'Waiting for Python kernel'
      : 'Run simulation (⌘+Enter)';

  const commitLegacyRename = async () => {
    const next = renameValue.trim();
    if (!next || next === legacyName) {
      setRenaming(false);
      setRenameValue('');
      return;
    }
    const ops = getFileOps();
    const result = ops ? await ops.renameFile(next) : null;
    if (!result) {
      inputRef.current?.select();
      return;
    }
    setRenaming(false);
    setRenameValue('');
  };

  const requestClose = requestCloseTab;

  const renderProjectTab = (path: string, isDirty: boolean) => {
    const isActive = path === activeTabPath;
    const name = basename(path);
    return (
      <div
        key={path}
        role="tab"
        data-tab-path={path}
        aria-selected={isActive}
        onClick={() => setActiveTab(path)}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            requestClose(path);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 12px',
          height: '100%',
          background: isActive ? colors.bgEditor : 'transparent',
          borderBottom: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
          fontSize: 12,
          fontFamily: "'Geist Sans', system-ui, sans-serif",
          color: isActive ? colors.text : colors.textDim,
          cursor: 'pointer',
          maxWidth: 220,
          flexShrink: 0,
          transition: 'background 120ms ease',
        }}
      >
        <FileCode
          size={13}
          style={{ color: isActive ? colors.accent : colors.textDim, flexShrink: 0 }}
        />
        {isDirty && (
          <span
            title="Unsaved changes"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: colors.warning,
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            requestClose(path);
          }}
          aria-label={`Close ${name}`}
          title={`Close ${name}`}
          style={{
            background: 'none',
            border: 'none',
            padding: 2,
            color: colors.textDim,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            borderRadius: 3,
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = colors.bgElevated;
            e.currentTarget.style.color = colors.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = colors.textDim;
          }}
        >
          <X size={12} />
        </button>
      </div>
    );
  };

  const renderLegacyTab = () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 12px',
        height: '100%',
        backgroundColor: colors.bgEditor,
        borderBottom: `2px solid ${colors.accent}`,
        fontSize: 12,
        fontFamily: "'Geist Sans', system-ui, sans-serif",
        color: colors.text,
        cursor: 'default',
        maxWidth: 260,
      }}
    >
      <FileCode size={13} style={{ color: colors.accent, flexShrink: 0 }} />
      {legacyIsDirty && !renaming && (
        <span
          title="Unsaved changes"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: colors.warning,
            flexShrink: 0,
          }}
        />
      )}
      {renaming ? (
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commitLegacyRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setRenaming(false);
              setRenameValue('');
            }
          }}
          onBlur={() => {
            void commitLegacyRename();
          }}
          aria-label="Rename file"
          style={{
            background: colors.bgElevated,
            border: `1px solid ${colors.accent}`,
            borderRadius: 3,
            color: colors.text,
            fontSize: 12,
            fontFamily: "'Geist Sans', system-ui, sans-serif",
            padding: '2px 6px',
            outline: 'none',
            minWidth: 120,
          }}
        />
      ) : (
        <span
          onDoubleClick={() => {
            setRenameValue(legacyName);
            setRenaming(true);
          }}
          title="Double-click to rename"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'text',
            userSelect: 'none',
          }}
        >
          {legacyName}
        </span>
      )}
    </div>
  );

  return (
    <div
      ref={barRef}
      style={{
        height: 40,
        display: 'flex',
        alignItems: 'stretch',
        backgroundColor: colors.bgPanel,
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
        overflow: 'hidden',
        paddingRight: 8,
        gap: 8,
      }}
    >
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Open files"
        onScroll={measure}
        style={{ display: 'flex', alignItems: 'stretch', overflowX: 'auto', overflowY: 'hidden', minWidth: 0, flex: '1 1 0', scrollbarWidth: 'none' }}
      >
        {usingLegacy ? renderLegacyTab() : tabs.map((t) => renderProjectTab(t.path, t.isDirty))}
      </div>

      {overflowing && !usingLegacy && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <button
            ref={overflowBtnRef}
            onClick={() => setOverflowOpen((o) => !o)}
            aria-label={`Show all ${tabs.length} open files`}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            title={`All open files (${tabs.length})`}
            style={{
              height: 26, display: 'flex', alignItems: 'center', gap: 3, padding: '0 6px',
              background: overflowOpen ? colors.bgElevated : 'transparent', color: colors.textDim,
              border: `1px solid ${colors.border}`, borderRadius: 5, cursor: 'pointer',
              fontSize: 11, fontFamily: "'Fira Code', monospace",
            }}
          >
            <ChevronDown size={12} /> {tabs.length}
          </button>
          {overflowOpen && overflowPos && createPortal(
            <div
              role="menu"
              data-tab-overflow-menu
              style={{
                position: 'fixed', top: overflowPos.top, right: overflowPos.right, zIndex: 1000,
                minWidth: 200, maxWidth: 320, maxHeight: 320, overflowY: 'auto', padding: '4px 0',
                background: colors.bgPanel, border: `1px solid ${colors.borderStrong}`, borderRadius: 6,
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              }}
            >
              {tabs.map((t) => (
                <button
                  key={t.path}
                  role="menuitem"
                  onClick={() => { setActiveTab(t.path); setOverflowOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 12px',
                    background: t.path === activeTabPath ? `${colors.accent}14` : 'transparent',
                    color: t.path === activeTabPath ? colors.accent : colors.text, border: 'none',
                    cursor: 'pointer', fontSize: 12, textAlign: 'left', fontFamily: "'Geist Sans', sans-serif",
                  }}
                >
                  <FileCode size={12} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{basename(t.path)}</span>
                  {t.isDirty && <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors.warning }} />}
                </button>
              ))}
            </div>,
            document.body,
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <FrameworkSelector />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button
          onClick={() => useHardwareStore.getState().openLaunch()}
          title="Launch on hardware (⌘⇧R)"
          aria-label="Launch on hardware"
          style={{
            height: 28,
            padding: compact ? '0 8px' : '0 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
            background: 'transparent',
            color: colors.accentLight,
            border: `1px solid ${colors.accent}40`,
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: "'Geist Sans', sans-serif",
            fontWeight: 600,
            transition: 'background 120ms ease, border-color 120ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `${colors.accent}12`;
            e.currentTarget.style.borderColor = colors.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = `${colors.accent}40`;
          }}
        >
          <Rocket size={12} />
          {!compact && <span>Launch</span>}
          {!compact && <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>⌘⇧R</span>}
        </button>
        <button
          onClick={handleRun}
          disabled={!canRun}
          title={runTitle}
          aria-label={runTitle}
          style={{
            height: 28,
            padding: tight ? '0 8px' : compact ? '0 10px' : '0 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            whiteSpace: 'nowrap',
            background: canRun ? colors.accent : colors.bgElevated,
            color: canRun ? '#0a0f1a' : colors.textDim,
            border: canRun ? 'none' : `1px solid ${colors.border}`,
            borderRadius: 6,
            cursor: canRun ? 'pointer' : 'default',
            fontSize: 13,
            fontFamily: "'Geist Sans', sans-serif",
            fontWeight: 600,
            boxShadow: canRun ? shadow.sm : 'none',
            transition:
              'transform 120ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 150ms ease, background 120ms ease',
          }}
          onMouseEnter={(e) => {
            if (canRun) {
              e.currentTarget.style.boxShadow = '0 0 14px rgba(0,180,216,0.4)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }
          }}
          onMouseLeave={(e) => {
            if (canRun) {
              e.currentTarget.style.boxShadow = shadow.sm;
              e.currentTarget.style.transform = 'translateY(0)';
            }
          }}
        >
          {isRunning ? (
            <Loader2 size={13} style={{ animation: 'nuclei-spin 800ms linear infinite' }} />
          ) : (
            <Play size={12} fill="currentColor" />
          )}
          {!tight && <span>{runLabel}</span>}
          {canRun && !compact && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                opacity: 0.75,
                marginLeft: 2,
                letterSpacing: 0.3,
              }}
            >
              ⌘↵
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
