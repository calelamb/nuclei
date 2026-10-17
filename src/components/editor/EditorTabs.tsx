import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useThemeStore } from '../../stores/themeStore';
import { X, FileCode, Play, Loader2, Rocket, ChevronDown, RotateCw, Square } from 'lucide-react';
import { getExecute, getFileOps } from '../../App';
import { requestCloseTab } from '../../lib/tabClose';
import { FrameworkSelector } from './FrameworkSelector';
import { useHardwareStore } from '../../stores/hardwareStore';
import { tabBarDensity, type TabBarDensity } from './tabBarLayout';
import { canStopKernelRun, retryKernel, stopKernelRun } from '../../lib/kernelControl';
import { getRunButtonState } from './runButtonState';
import { Button, IconButton, Tooltip } from '../ui';
import { shortcutLabel } from '../../config/keybindings';
import { useUiFeatures } from '../../hooks/useUiFeatures';

import { TYPOGRAPHY } from '../../styles/tokens';
const basename = (p: string) => p.split('/').pop() ?? p;

export function EditorTabs() {
  const tabs = useProjectStore((s) => s.tabs);
  const activeTabPath = useProjectStore((s) => s.activeTabPath);
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const legacyFilePath = useEditorStore((s) => s.filePath);
  const legacyIsDirty = useEditorStore((s) => s.isDirty);
  const kernelReady = useEditorStore((s) => s.kernelReady);
  const kernelStatus = useEditorStore((s) => s.kernelStatus);
  const kernelError = useEditorStore((s) => s.kernelError);
  const kernelProgress = useEditorStore((s) => s.kernelProgress);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const colors = useThemeStore((s) => s.colors);
  const features = useUiFeatures();

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

  const runState = getRunButtonState({ kernelReady, kernelStatus, kernelProgress, kernelError, isRunning, canStop: canStopKernelRun() });
  const canRun = runState.kind === 'ready';
  const handleRun = () => {
    if (runState.stoppable) {
      stopKernelRun();
      return;
    }
    if (runState.kind === 'failed') {
      retryKernel();
      return;
    }
    const e = getExecute();
    if (e) e();
  };
  // A narrow toolbar can't fit the long failure label; the banner carries the detail.
  const runLabel = runState.kind === 'failed' && compact ? 'Retry kernel' : runState.label;
  const runTitle = runState.title;
  const runFailed = runState.kind === 'failed';

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
          fontFamily: TYPOGRAPHY.fontSans,
          color: isActive ? colors.text : colors.textDim,
          cursor: 'pointer',
          maxWidth: 220,
          flexShrink: 0,
          transition: 'background 120ms ease',
        }}
      >
        <FileCode
          size={14}
          style={{ color: isActive ? colors.accentText : colors.textDim, flexShrink: 0 }}
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
        <IconButton
          size="sm"
          className="nuclei-tab-close"
          aria-label={`Close ${name}`}
          tooltip={{ label: `Close ${name}`, placement: 'below' }}
          onClick={(e) => {
            e.stopPropagation();
            requestClose(path);
          }}
        >
          <X size={12} />
        </IconButton>
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
        fontFamily: TYPOGRAPHY.fontSans,
        color: colors.text,
        cursor: 'default',
        maxWidth: 260,
        minWidth: 0,
      }}
    >
      <FileCode size={14} style={{ color: colors.accentText, flexShrink: 0 }} />
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
            fontFamily: TYPOGRAPHY.fontSans,
            padding: '2px 6px',
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
          <Button
            ref={overflowBtnRef}
            size="md"
            onClick={() => setOverflowOpen((o) => !o)}
            aria-label={`Show all ${tabs.length} open files`}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            icon={<ChevronDown size={12} />}
          >
            {tabs.length}
          </Button>
          {overflowOpen && overflowPos && createPortal(
            <div
              role="menu"
              data-tab-overflow-menu
              style={{
                position: 'fixed', top: overflowPos.top, right: overflowPos.right, zIndex: 1000,
                minWidth: 200, maxWidth: 320, maxHeight: 320, overflowY: 'auto', padding: '4px 0',
                background: colors.bgPanel, border: `1px solid ${colors.borderStrong}`, borderRadius: 6,
                boxShadow: 'var(--shadow-popover, 0 8px 24px rgba(0,0,0,0.25))',
              }}
            >
              {tabs.map((t) => (
                <button
                  key={t.path}
                  role="menuitem"
                  onClick={() => { setActiveTab(t.path); setOverflowOpen(false); }}
                  className="nuclei-menu-item"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 12px',
                    background: t.path === activeTabPath ? `${colors.accent}14` : 'transparent',
                    color: t.path === activeTabPath ? colors.accentText : colors.text, border: 'none',
                    cursor: 'pointer', fontSize: 12, textAlign: 'left', fontFamily: TYPOGRAPHY.fontSans,
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

      {features.frameworkPicker && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <FrameworkSelector compact={compact} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {features.launchHardware && (
          <Tooltip label="Launch on hardware" shortcut={shortcutLabel('launch')}>
            <Button
              variant="secondary"
              onClick={() => useHardwareStore.getState().openLaunch()}
              aria-label="Launch on hardware"
              icon={<Rocket size={12} />}
            >
              {!compact && <span>Launch</span>}
              {!compact && <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 2 }}>{shortcutLabel('launch')}</span>}
            </Button>
          </Tooltip>
        )}
        <Tooltip label={runTitle} shortcut={canRun ? shortcutLabel('run') : undefined}>
          <Button
            variant={canRun ? 'primary' : runFailed ? 'danger' : 'secondary'}
            onClick={handleRun}
            disabled={runState.disabled}
            aria-label={runTitle}
            style={{ fontWeight: 600, padding: tight ? '0 8px' : compact ? '0 10px' : '0 14px', gap: 7 }}
          >
            {runState.stoppable ? (
              <Square size={11} fill="currentColor" />
            ) : isRunning || runState.kind === 'loading' ? (
              <Loader2 size={13} className="nuclei-spin" />
            ) : runFailed ? (
              <RotateCw size={12} />
            ) : (
              <Play size={12} fill="currentColor" />
            )}
            {!tight && <span>{runLabel}</span>}
            {canRun && !compact && (
              <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.75, marginLeft: 2, letterSpacing: 0.3 }}>
                {shortcutLabel('run')}
              </span>
            )}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
