import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useThemeStore } from '../../stores/themeStore';
import { X, FileCode, Play, Loader2, Rocket, RotateCw, Square } from 'lucide-react';
import { getExecute, getFileOps } from '../../App';
import { requestCloseTab } from '../../lib/tabClose';
import { FrameworkSelector } from './FrameworkSelector';
import { useHardwareStore } from '../../stores/hardwareStore';
import { canStopKernelRun, retryKernel, stopKernelRun } from '../../lib/kernelControl';
import { useElementSize } from '../../hooks/useElementSize';
import { getRunButtonState } from './runButtonState';

// Strip width under which secondary hints collapse (tab + framework + Launch + Run).
const COMPACT_STRIP_WIDTH = 560;

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
  const shadow = useThemeStore((s) => s.shadow);

  const [stripRef, stripSize] = useElementSize<HTMLDivElement>();
  // Below this width the shortcut hint on Launch is dropped so Run never clips.
  const compact = stripSize.width > 0 && stripSize.width < COMPACT_STRIP_WIDTH;
  const usingLegacy = tabs.length === 0;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const legacyName = legacyFilePath ? basename(legacyFilePath) : 'untitled.py';

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

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
          minWidth: 0,
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
        minWidth: 0,
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
      ref={stripRef}
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
      <div style={{ display: 'flex', alignItems: 'stretch', overflow: 'hidden', minWidth: 48, flexShrink: 2 }}>
        {usingLegacy ? renderLegacyTab() : tabs.map((t) => renderProjectTab(t.path, t.isDirty))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 1, minWidth: 72 }}>
        <FrameworkSelector compact={compact} />
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button
          onClick={() => useHardwareStore.getState().openLaunch()}
          title="Launch on hardware (⌘⇧R)"
          aria-label="Launch on hardware"
          style={{
            height: 28,
            padding: compact ? '0 8px' : '0 12px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
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
          disabled={runState.disabled}
          title={runTitle}
          aria-label={runTitle}
          style={{
            height: 28,
            padding: '0 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            flexShrink: 0,
            whiteSpace: 'nowrap',
            background: canRun ? colors.accent : colors.bgElevated,
            color: canRun ? '#0a0f1a' : runFailed ? colors.error : runState.stoppable ? colors.text : colors.textMuted,
            border: canRun ? 'none' : `1px solid ${runFailed ? colors.error : colors.border}`,
            borderRadius: 6,
            cursor: runState.disabled ? 'default' : 'pointer',
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
          {runState.stoppable ? (
            <Square size={11} fill="currentColor" />
          ) : isRunning || runState.kind === 'loading' ? (
            <Loader2 size={13} style={{ animation: 'nuclei-spin 800ms linear infinite' }} />
          ) : runFailed ? (
            <RotateCw size={12} />
          ) : (
            <Play size={12} fill="currentColor" />
          )}
          <span>{runLabel}</span>
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
