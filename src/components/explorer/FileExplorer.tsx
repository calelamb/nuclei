import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FolderOpen,
  FilePlus,
  RefreshCw,
  FileCode,
  Atom,
  Braces,
  FileText,
  Folder,
  File as FileIconLucide,
  ChevronRight,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
import { usePlatform } from '../../platform/PlatformProvider';
import type { DirEntry } from '../../platform/bridge';

const EXTENSION_ICONS: Record<string, LucideIcon> = {
  py: FileCode,
  qasm: Atom,
  json: Braces,
  md: FileText,
  txt: FileText,
};

function iconFor(name: string, isDir: boolean, color: string) {
  if (isDir) return <Folder size={13} style={{ color, marginRight: 6, flexShrink: 0 }} />;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const Icon = EXTENSION_ICONS[ext] ?? FileIconLucide;
  return <Icon size={13} style={{ color, marginRight: 6, flexShrink: 0 }} />;
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

export function FileExplorer() {
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const setProjectRoot = useProjectStore((s) => s.setProjectRoot);
  const openTab = useProjectStore((s) => s.openTab);
  const tabs = useProjectStore((s) => s.tabs);
  const activeTabPath = useProjectStore((s) => s.activeTabPath);
  const colors = useThemeStore((s) => s.colors);
  const platform = usePlatform();
  const isWeb = platform.getPlatform() === 'web';

  const [rootEntries, setRootEntries] = useState<DirEntry[] | null>(null);
  const [childEntries, setChildEntries] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [newFileMode, setNewFileMode] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  const loadRoot = useCallback(
    async (rootPath: string) => {
      setLoading(true);
      setError(null);
      const entries = await platform.listDirectory(rootPath);
      setLoading(false);
      if (!entries) {
        setError('Could not read folder.');
        return;
      }
      setRootEntries(entries);
      setChildEntries({});
      setExpanded({});
    },
    [platform],
  );

  useEffect(() => {
    if (projectRoot) loadRoot(projectRoot);
    else setRootEntries(null);
  }, [projectRoot, loadRoot]);

  const handleOpenFolder = useCallback(async () => {
    const picked = await platform.openDirectory();
    if (!picked) return;
    setProjectRoot(picked.path);
    platform.setStoredValue('project_root', picked.path).catch(() => {});
  }, [platform, setProjectRoot]);

  const handleRefresh = useCallback(() => {
    if (projectRoot) loadRoot(projectRoot);
  }, [projectRoot, loadRoot]);

  const handleOpenFile = useCallback(
    async (path: string) => {
      const existing = tabs.find((t) => t.path === path);
      if (existing) {
        useProjectStore.getState().setActiveTab(path);
        return;
      }
      const content = await platform.readFile(path);
      if (content === null) {
        setError(`Could not open ${basename(path)}.`);
        return;
      }
      openTab({ path, content });
    },
    [tabs, platform, openTab],
  );

  const toggleExpand = useCallback(
    async (path: string) => {
      const isOpen = !!expanded[path];
      setExpanded((e) => ({ ...e, [path]: !isOpen }));
      if (!isOpen && !childEntries[path]) {
        const entries = await platform.listDirectory(path);
        if (entries) setChildEntries((c) => ({ ...c, [path]: entries }));
      }
    },
    [expanded, childEntries, platform],
  );

  const handleNewFile = useCallback(async () => {
    const name = newFileName.trim();
    if (!name || !projectRoot) {
      setNewFileMode(false);
      setNewFileName('');
      return;
    }
    const safe = name.endsWith('.py') || name.includes('.') ? name : `${name}.py`;
    const path = `${projectRoot}/${safe}`;
    const res = await platform.createFile(path, '');
    setNewFileMode(false);
    setNewFileName('');
    if (!res) {
      setError(`Couldn't create ${safe} (already exists?).`);
      return;
    }
    await loadRoot(projectRoot);
    openTab({ path: res.path, content: '' });
  }, [newFileName, projectRoot, platform, loadRoot, openTab]);

  const commitRename = useCallback(
    async (oldPath: string) => {
      const draft = renameDraft.trim();
      setRenameTarget(null);
      if (!draft || draft === basename(oldPath)) return;
      const res = await platform.renameFile(oldPath, draft);
      if (res) {
        useProjectStore.getState().renameTab(oldPath, res.path);
        if (projectRoot) loadRoot(projectRoot);
      }
    },
    [renameDraft, platform, projectRoot, loadRoot],
  );

  const rowStyle = (isActive: boolean, depth: number): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    padding: `3px 8px 3px ${8 + depth * 12}px`,
    fontSize: 12,
    fontFamily: "'Geist Sans', sans-serif",
    color: isActive ? colors.accent : colors.text,
    background: isActive ? `${colors.accent}10` : 'transparent',
    cursor: 'pointer',
    userSelect: 'none',
  });

  const renderEntry = (entry: DirEntry, depth: number): React.ReactNode => {
    const isActive = activeTabPath === entry.path;
    const isExpanded = !!expanded[entry.path];
    if (entry.kind === 'directory') {
      const children = childEntries[entry.path];
      return (
        <div key={entry.path}>
          <div
            role="treeitem"
            aria-expanded={isExpanded}
            onClick={() => toggleExpand(entry.path)}
            style={rowStyle(false, depth)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = colors.bgElevated;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {isExpanded ? (
              <ChevronDown size={12} style={{ color: colors.textDim, marginRight: 2 }} />
            ) : (
              <ChevronRight size={12} style={{ color: colors.textDim, marginRight: 2 }} />
            )}
            {iconFor(entry.name, true, colors.textMuted)}
            <span
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {entry.name}
            </span>
          </div>
          {isExpanded && children && (
            <div>{children.map((c) => renderEntry(c, depth + 1))}</div>
          )}
        </div>
      );
    }
    if (renameTarget === entry.path) {
      return (
        <div key={entry.path} style={rowStyle(isActive, depth)}>
          <input
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => commitRename(entry.path)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename(entry.path);
              }
              if (e.key === 'Escape') setRenameTarget(null);
            }}
            style={{
              flex: 1,
              background: colors.bgElevated,
              border: `1px solid ${colors.accent}`,
              color: colors.text,
              fontSize: 12,
              padding: '2px 6px',
              borderRadius: 4,
              outline: 'none',
              fontFamily: "'Geist Sans', sans-serif",
            }}
          />
        </div>
      );
    }
    return (
      <div
        key={entry.path}
        role="treeitem"
        onClick={() => handleOpenFile(entry.path)}
        onDoubleClick={() => {
          setRenameDraft(entry.name);
          setRenameTarget(entry.path);
        }}
        style={rowStyle(isActive, depth)}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = colors.bgElevated;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = isActive
            ? `${colors.accent}10`
            : 'transparent';
        }}
      >
        {iconFor(entry.name, false, isActive ? colors.accent : colors.textMuted)}
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {entry.name}
        </span>
      </div>
    );
  };

  const rootName = useMemo(
    () => (projectRoot ? projectRoot.split('/').pop() || projectRoot : ''),
    [projectRoot],
  );

  if (isWeb) {
    return (
      <div
        style={{
          padding: 14,
          color: colors.textDim,
          fontSize: 12,
          fontFamily: "'Geist Sans', sans-serif",
          lineHeight: 1.6,
        }}
      >
        Folder projects are a desktop-only feature right now. Download Nuclei from{' '}
        <a href="https://getnuclei.dev" style={{ color: colors.accent }}>
          getnuclei.dev
        </a>{' '}
        to open a whole lecture folder. You can still edit and simulate circuits here.
      </div>
    );
  }

  if (!projectRoot) {
    return (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p
          style={{
            color: colors.textMuted,
            fontSize: 12,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          Open a folder to start a project. Any folder works — no config file required.
        </p>
        <button
          onClick={handleOpenFolder}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            justifyContent: 'center',
            padding: '7px 12px',
            background: colors.accent,
            color: '#0a0f1a',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
            cursor: 'pointer',
          }}
        >
          <FolderOpen size={13} /> Open Folder…
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '6px 10px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span
          title={projectRoot}
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: colors.textMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          {rootName}
        </span>
        <button
          title="New file"
          onClick={() => {
            setNewFileMode(true);
            setNewFileName('');
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.textDim,
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            borderRadius: 4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = colors.text;
            e.currentTarget.style.background = colors.bgElevated;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = colors.textDim;
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <FilePlus size={13} />
        </button>
        <button
          title="Refresh"
          onClick={handleRefresh}
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.textDim,
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            borderRadius: 4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = colors.text;
            e.currentTarget.style.background = colors.bgElevated;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = colors.textDim;
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <RefreshCw size={12} />
        </button>
        <button
          title="Close folder"
          onClick={() => {
            setProjectRoot(null);
            platform.setStoredValue('project_root', null).catch(() => {});
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.textDim,
            cursor: 'pointer',
            padding: 4,
            fontSize: 11,
            fontFamily: "'Geist Sans', sans-serif",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = colors.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = colors.textDim;
          }}
        >
          ×
        </button>
      </div>

      {newFileMode && (
        <div style={{ padding: '4px 8px', borderBottom: `1px solid ${colors.border}` }}>
          <input
            autoFocus
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onBlur={handleNewFile}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleNewFile();
              }
              if (e.key === 'Escape') {
                setNewFileMode(false);
                setNewFileName('');
              }
            }}
            placeholder="filename.py"
            style={{
              width: '100%',
              background: colors.bgElevated,
              border: `1px solid ${colors.accent}`,
              color: colors.text,
              fontSize: 12,
              padding: '4px 8px',
              borderRadius: 4,
              outline: 'none',
              fontFamily: "'Geist Sans', sans-serif",
            }}
          />
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <div
            style={{
              padding: 14,
              color: colors.textDim,
              fontSize: 12,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            Loading…
          </div>
        )}
        {error && (
          <div
            style={{
              padding: 14,
              color: colors.error,
              fontSize: 12,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            {error}
          </div>
        )}
        {!loading && !error && rootEntries && rootEntries.map((e) => renderEntry(e, 0))}
        {!loading && !error && rootEntries && rootEntries.length === 0 && (
          <div
            style={{
              padding: 14,
              color: colors.textDim,
              fontSize: 12,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            Folder is empty. Click the + to add a file.
          </div>
        )}
      </div>
    </div>
  );
}
