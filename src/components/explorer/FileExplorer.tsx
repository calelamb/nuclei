import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FolderOpen,
  FilePlus,
  FolderPlus,
  Package,
  Atom as AtomIcon,
  Plus,
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
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { usePlatform } from '../../platform/PlatformProvider';
import type { DirEntry } from '../../platform/bridge';
import type { Framework } from '../../types/quantum';
import {
  STARTER_TEMPLATES,
  displayFrameworkName,
  defaultCircuitFileName,
} from '../../data/starterTemplates';

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

type CreateKind =
  | { kind: 'file'; initial: string }
  | { kind: 'folder'; initial: string }
  | { kind: 'package'; initial: string }
  | { kind: 'circuit'; framework: Framework; initial: string };

function createKindLabel(c: CreateKind): string {
  switch (c.kind) {
    case 'file': return 'New file';
    case 'folder': return 'New folder';
    case 'package': return 'New Python package';
    case 'circuit': return `New ${displayFrameworkName(c.framework)} circuit`;
  }
}

export function FileExplorer() {
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const setProjectRoot = useProjectStore((s) => s.setProjectRoot);
  const openTab = useProjectStore((s) => s.openTab);
  const tabs = useProjectStore((s) => s.tabs);
  const activeTabPath = useProjectStore((s) => s.activeTabPath);
  const setEditorFramework = useEditorStore((s) => s.setFramework);
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
  const [pending, setPending] = useState<CreateKind | null>(null);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [circuitSubmenu, setCircuitSubmenu] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuContainerRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
      setCircuitSubmenu(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const handleOpenFolder = useCallback(async () => {
    const picked = await platform.openDirectory();
    if (!picked) return;
    setProjectRoot(picked.path);
    platform.setStoredValue('project_root', picked.path).catch(() => {});
  }, [platform, setProjectRoot]);

  const handleNewProject = useCallback(async () => {
    const parent = await platform.openDirectory();
    if (!parent) return;
    const name = window.prompt(
      'Project name',
      'my-quantum-project',
    )?.trim();
    if (!name) return;
    if (!/^[A-Za-z0-9_.\- ]+$/.test(name)) {
      setError('Project name can only contain letters, numbers, spaces, dots, hyphens, and underscores.');
      return;
    }
    const projectPath = `${parent.path}/${name}`;
    const dir = await platform.createDirectory(projectPath, false);
    if (!dir) {
      setError(`Couldn't create "${name}" — does it already exist?`);
      return;
    }
    const currentFramework = useEditorStore.getState().framework;
    const mainPath = `${projectPath}/main.py`;
    const mainRes = await platform.createFile(mainPath, STARTER_TEMPLATES[currentFramework]);
    await platform.createFile(`${projectPath}/README.md`, `# ${name}\n\nQuantum project scaffolded by Nuclei (${displayFrameworkName(currentFramework)}).\n`);
    setProjectRoot(projectPath);
    platform.setStoredValue('project_root', projectPath).catch(() => {});
    if (mainRes) {
      openTab({ path: mainRes.path, content: STARTER_TEMPLATES[currentFramework] });
    }
  }, [platform, setProjectRoot, openTab]);

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

  const startCreate = (c: CreateKind) => {
    setPending(c);
    setDraft(c.initial);
    setMenuOpen(false);
    setCircuitSubmenu(false);
  };

  const cancelCreate = () => {
    setPending(null);
    setDraft('');
  };

  const commitCreate = useCallback(async () => {
    const raw = draft.trim();
    if (!raw || !projectRoot || !pending) {
      cancelCreate();
      return;
    }
    if (raw.includes('/') || raw.includes('\\')) {
      setError('Names cannot contain slashes. Use the file tree to choose a location.');
      cancelCreate();
      return;
    }

    if (pending.kind === 'folder') {
      const path = `${projectRoot}/${raw}`;
      const res = await platform.createDirectory(path, false);
      cancelCreate();
      if (!res) { setError(`Couldn't create folder ${raw}.`); return; }
      await loadRoot(projectRoot);
      return;
    }

    if (pending.kind === 'package') {
      const path = `${projectRoot}/${raw}`;
      const dir = await platform.createDirectory(path, false);
      if (!dir) { setError(`Couldn't create package ${raw}.`); cancelCreate(); return; }
      await platform.createFile(`${path}/__init__.py`, '');
      cancelCreate();
      await loadRoot(projectRoot);
      return;
    }

    // file / circuit share the same create-a-file path
    const name = raw.endsWith('.py') || raw.includes('.') ? raw : `${raw}.py`;
    const path = `${projectRoot}/${name}`;
    const content = pending.kind === 'circuit' ? STARTER_TEMPLATES[pending.framework] : '';
    const res = await platform.createFile(path, content);
    cancelCreate();
    if (!res) { setError(`Couldn't create ${name} (already exists?).`); return; }
    if (pending.kind === 'circuit') setEditorFramework(pending.framework);
    await loadRoot(projectRoot);
    openTab({ path: res.path, content });
  }, [draft, pending, projectRoot, platform, loadRoot, openTab, setEditorFramework]);

  const commitRename = useCallback(
    async (oldPath: string) => {
      const d = renameDraft.trim();
      setRenameTarget(null);
      if (!d || d === basename(oldPath)) return;
      const res = await platform.renameFile(oldPath, d);
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
    const primaryBtn: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      justifyContent: 'center',
      padding: '8px 12px',
      background: colors.accent,
      color: '#0a0f1a',
      border: 'none',
      borderRadius: 6,
      fontSize: 12,
      fontWeight: 600,
      fontFamily: "'Geist Sans', sans-serif",
      cursor: 'pointer',
    };
    const secondaryBtn: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      justifyContent: 'center',
      padding: '8px 12px',
      background: 'transparent',
      color: colors.text,
      border: `1px solid ${colors.border}`,
      borderRadius: 6,
      fontSize: 12,
      fontWeight: 500,
      fontFamily: "'Geist Sans', sans-serif",
      cursor: 'pointer',
    };
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
          Start a new quantum project or open an existing folder.
        </p>
        <button onClick={handleNewProject} style={primaryBtn}>
          <Plus size={13} /> New Project…
        </button>
        <button onClick={handleOpenFolder} style={secondaryBtn}>
          <FolderOpen size={13} /> Open Folder…
        </button>
        {error && (
          <div style={{ color: colors.error, fontSize: 11 }}>{error}</div>
        )}
      </div>
    );
  }

  const menuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 12px',
    background: 'transparent',
    color: colors.text,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: "'Geist Sans', sans-serif",
    textAlign: 'left',
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '6px 10px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          position: 'relative',
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
        <div ref={menuContainerRef} style={{ position: 'relative' }}>
          <button
            title="New…"
            onClick={() => {
              setMenuOpen((o) => !o);
              setCircuitSubmenu(false);
            }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            style={{
              background: menuOpen ? colors.bgElevated : 'transparent',
              border: 'none',
              color: menuOpen ? colors.text : colors.textDim,
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
              if (!menuOpen) {
                e.currentTarget.style.color = colors.textDim;
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <Plus size={14} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 4px)',
                background: colors.bgPanel,
                border: `1px solid ${colors.borderStrong}`,
                borderRadius: 6,
                minWidth: 220,
                zIndex: 100,
                overflow: 'visible',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                padding: '4px 0',
              }}
            >
              <button
                style={menuItemStyle}
                onClick={() => startCreate({ kind: 'file', initial: 'untitled.py' })}
                onMouseEnter={(e) => { e.currentTarget.style.background = `${colors.accent}12`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <FilePlus size={13} style={{ color: colors.textDim }} /> New File
                <span style={{ marginLeft: 'auto', fontSize: 10, color: colors.textDim }}>.py</span>
              </button>

              <div
                style={{ position: 'relative' }}
                onMouseEnter={() => setCircuitSubmenu(true)}
                onMouseLeave={() => setCircuitSubmenu(false)}
              >
                <button
                  style={menuItemStyle}
                  onClick={() => setCircuitSubmenu((s) => !s)}
                >
                  <AtomIcon size={13} style={{ color: colors.accentLight }} /> New Circuit
                  <ChevronRight size={12} style={{ marginLeft: 'auto', color: colors.textDim }} />
                </button>
                {circuitSubmenu && (
                  <div
                    role="menu"
                    style={{
                      position: 'absolute',
                      right: '100%',
                      top: 0,
                      marginRight: 4,
                      background: colors.bgPanel,
                      border: `1px solid ${colors.borderStrong}`,
                      borderRadius: 6,
                      minWidth: 180,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                      padding: '4px 0',
                    }}
                  >
                    {(['qiskit', 'cirq', 'cuda-q'] as Framework[]).map((f) => (
                      <button
                        key={f}
                        style={menuItemStyle}
                        onClick={() => startCreate({
                          kind: 'circuit',
                          framework: f,
                          initial: defaultCircuitFileName(f),
                        })}
                        onMouseEnter={(e) => { e.currentTarget.style.background = `${colors.accent}12`; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <AtomIcon size={13} style={{ color: colors.accentLight }} />
                        {displayFrameworkName(f)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ borderTop: `1px solid ${colors.border}`, margin: '4px 0' }} />

              <button
                style={menuItemStyle}
                onClick={() => startCreate({ kind: 'package', initial: 'new_package' })}
                onMouseEnter={(e) => { e.currentTarget.style.background = `${colors.accent}12`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Package size={13} style={{ color: colors.textDim }} /> New Python Package
              </button>
              <button
                style={menuItemStyle}
                onClick={() => startCreate({ kind: 'folder', initial: 'new_folder' })}
                onMouseEnter={(e) => { e.currentTarget.style.background = `${colors.accent}12`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <FolderPlus size={13} style={{ color: colors.textDim }} /> New Folder
              </button>
            </div>
          )}
        </div>
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

      {pending && (
        <div style={{ padding: '4px 8px', borderBottom: `1px solid ${colors.border}` }}>
          <div
            style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              color: colors.textDim,
              padding: '2px 2px 4px',
            }}
          >
            {createKindLabel(pending)}
          </div>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitCreate}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitCreate(); }
              if (e.key === 'Escape') cancelCreate();
            }}
            placeholder={pending.initial}
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
            Folder is empty. Click + to add a file, package, or circuit.
          </div>
        )}
      </div>
    </div>
  );
}
