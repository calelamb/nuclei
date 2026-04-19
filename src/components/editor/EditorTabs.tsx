import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useThemeStore } from '../../stores/themeStore';
import { useDialogStore } from '../../stores/dialogStore';
import { X, FileCode, Play, Loader2, Rocket } from 'lucide-react';
import { getExecute, getFileOps } from '../../App';
import { FrameworkSelector } from './FrameworkSelector';
import { useHardwareStore } from '../../stores/hardwareStore';

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
  const legacyName = legacyFilePath ? basename(legacyFilePath) : 'untitled.py';

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const canRun = kernelReady && !isRunning;
  const handleRun = () => {
    const e = getExecute();
    if (e) e();
  };
  const runLabel = isRunning ? 'Running…' : !kernelReady ? 'Loading kernel…' : 'Run';
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

  const requestClose = (path: string) => {
    const tab = useProjectStore.getState().tabs.find((t) => t.path === path);
    if (!tab) return;
    if (!tab.isDirty) {
      useProjectStore.getState().closeTab(path);
      return;
    }
    useDialogStore.getState().requestClose({
      fileName: basename(path),
      onSave: async () => {
        useProjectStore.getState().setActiveTab(path);
        const ops = getFileOps();
        if (ops) await ops.saveFile();
        useProjectStore.getState().markTabSaved(path, tab.content);
        useProjectStore.getState().closeTab(path);
      },
      onDontSave: () => useProjectStore.getState().closeTab(path),
      onCancel: () => {},
    });
  };

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
      <div style={{ display: 'flex', alignItems: 'stretch', overflow: 'auto', minWidth: 0 }}>
        {usingLegacy ? renderLegacyTab() : tabs.map((t) => renderProjectTab(t.path, t.isDirty))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <FrameworkSelector />
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={() => useHardwareStore.getState().openLaunch()}
          title="Launch on hardware (⌘⇧R)"
          aria-label="Launch on hardware"
          style={{
            height: 28,
            padding: '0 12px',
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
          <span>Launch</span>
          <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>⌘⇧R</span>
        </button>
        <button
          onClick={handleRun}
          disabled={!canRun}
          title={runTitle}
          aria-label={runTitle}
          style={{
            height: 28,
            padding: '0 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
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
          <span>{runLabel}</span>
          {canRun && (
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
