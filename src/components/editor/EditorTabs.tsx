import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useThemeStore } from '../../stores/themeStore';
import { X, FileCode, Play, Loader2 } from 'lucide-react';
import { getExecute, getFileOps } from '../../App';
import { FrameworkSelector } from './FrameworkSelector';

export function EditorTabs() {
  const filePath = useEditorStore((s) => s.filePath);
  const isDirty = useEditorStore((s) => s.isDirty);
  const kernelReady = useEditorStore((s) => s.kernelReady);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  const [tabHovered, setTabHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const fileName = filePath ? filePath.split('/').pop() ?? 'untitled.py' : 'untitled.py';
  const canRun = kernelReady && !isRunning;

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const startRename = () => {
    setRenameValue(fileName);
    setRenaming(true);
  };

  const cancelRename = () => {
    setRenaming(false);
    setRenameValue('');
  };

  const commitRename = async () => {
    const next = renameValue.trim();
    if (!next || next === fileName) {
      cancelRename();
      return;
    }
    const ops = getFileOps();
    if (!ops) {
      cancelRename();
      return;
    }
    const result = await ops.renameFile(next);
    if (!result) {
      // Rename failed (collision or FS error). Leave the input open so the
      // user can adjust or cancel — surfaces the problem instead of silently
      // discarding the attempt.
      inputRef.current?.select();
      return;
    }
    setRenaming(false);
    setRenameValue('');
  };

  const handleRun = () => {
    const e = getExecute();
    if (e) e();
  };

  const handleClose = () => {
    if (isDirty) {
      const ok = window.confirm('You have unsaved changes. Close the tab anyway?');
      if (!ok) return;
    }
    // The app keeps a single active buffer for now — closing resets to an
    // untitled scratch. Multi-tab close is wired via the project store
    // elsewhere.
    const ops = getFileOps();
    if (ops) ops.newFile();
  };

  const runLabel = isRunning
    ? 'Running…'
    : !kernelReady
      ? 'Loading kernel…'
      : 'Run';
  const runTitle = isRunning
    ? 'Simulation running'
    : !kernelReady
      ? 'Waiting for Python kernel'
      : 'Run simulation (⌘+Enter)';

  return (
    <div
      style={{
        height: 40,
        display: 'flex',
        alignItems: 'center',
        backgroundColor: colors.bgPanel,
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
        overflow: 'hidden',
        paddingRight: 8,
        gap: 8,
      }}
    >
      {/* Active file tab */}
      <div
        onMouseEnter={() => setTabHovered(true)}
        onMouseLeave={() => setTabHovered(false)}
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
          position: 'relative',
        }}
      >
        <FileCode size={13} style={{ color: colors.accent, flexShrink: 0 }} />
        {isDirty && !renaming && (
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
                void commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={() => { void commitRename(); }}
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
            onDoubleClick={startRename}
            title="Double-click to rename"
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'text',
              userSelect: 'none',
            }}
          >
            {fileName}
          </span>
        )}
        {!renaming && (
          <button
            onClick={handleClose}
            title="Close tab"
            aria-label="Close tab"
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
              opacity: tabHovered ? 1 : 0,
              transition: 'opacity 150ms ease, background 120ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = colors.bgElevated;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Framework selector next to the tab */}
      <FrameworkSelector />

      {/* Flex spacer pushes Run to the right */}
      <div style={{ flex: 1 }} />

      {/* Prominent Run button */}
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
          transition: 'transform 120ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 150ms ease, background 120ms ease',
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
  );
}
