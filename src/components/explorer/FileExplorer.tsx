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
  Sigma,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button, IconButton } from '../ui';
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
import { MEMORY_PREFIX, isMemoryPath } from '../../hooks/useFileOps';
import { flattenVisible, resolveTreeKey } from './treeNavigation';

import { TYPOGRAPHY } from '../../styles/tokens';
const EXTENSION_ICONS: Record<string, LucideIcon> = {
  py: FileCode,
  qs: Sigma,
  qasm: Atom,
  json: Braces,
  md: FileText,
  txt: FileText,
};

function iconFor(name: string, isDir: boolean, color: string) {
  if (isDir) return <Folder size={14} style={{ color, marginRight: 6, flexShrink: 0 }} />;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const Icon = EXTENSION_ICONS[ext] ?? FileIconLucide;
  return <Icon size={14} style={{ color, marginRight: 6, flexShrink: 0 }} />;
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
  const treeRef = useRef<HTMLDivElement>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

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

  /**
   * Re-read the root listing but keep every expanded folder open (refetching
   * only those), so refresh / create / rename never collapse the user's tree.
   */
  const reloadTree = useCallback(
    async (rootPath: string) => {
      setError(null);
      const entries = await platform.listDirectory(rootPath);
      if (!entries) {
        setError('Could not read folder.');
        return;
      }
      const openPaths = Object.keys(expanded).filter((p) => expanded[p]);
      const refreshed = await Promise.all(
        openPaths.map(async (p) => [p, await platform.listDirectory(p)] as const),
      );
      const stillOpen = refreshed.filter((r): r is readonly [string, DirEntry[]] => r[1] !== null);
      setRootEntries(entries);
      setChildEntries(Object.fromEntries(stillOpen));
      setExpanded(Object.fromEntries(stillOpen.map(([p]) => [p, true])));
    },
    [platform, expanded],
  );

  const inMemory = isMemoryPath(projectRoot);
  useEffect(() => {
    queueMicrotask(() => {
      if (projectRoot && !isMemoryPath(projectRoot)) void loadRoot(projectRoot);
      else setRootEntries(null);
    });
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

  /**
   * Create a fresh in-memory project. No disk I/O, no native Finder dialog —
   * a synthetic project root is stashed in projectStore and a single
   * untitled `main.py` tab is opened with the current framework's starter
   * code. The user writes code, then on ⌘S a native save dialog lets them
   * pick a real location; on save the tab re-paths and the project root
   * migrates to the saved file's parent folder (see useFileOps.saveFileAs).
   */
  const handleNewProject = useCallback(() => {
    const id = Date.now();
    const memRoot = `${MEMORY_PREFIX}project-${id}`;
    const currentFramework = useEditorStore.getState().framework;
    setProjectRoot(memRoot);
    platform.setStoredValue('project_root', null).catch(() => {});
    openTab({
      path: `${memRoot}/main.py`,
      content: STARTER_TEMPLATES[currentFramework],
    });
  }, [platform, setProjectRoot, openTab]);

  const handleRefresh = useCallback(() => {
    if (projectRoot) void reloadTree(projectRoot);
  }, [projectRoot, reloadTree]);

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

    // In an in-memory (unsaved) project, all "creates" produce in-memory
    // tabs only. Folders and packages don't exist as concepts until the
    // project has a real location on disk — we block them with a hint
    // instead of silently doing nothing. Save the project first (⌘S on
    // any file) to promote it to a real folder, then folder/package
    // creation works normally.
    if (isMemoryPath(projectRoot)) {
      if (pending.kind === 'folder' || pending.kind === 'package') {
        setError('Save the project first (⌘S) to add folders or packages.');
        cancelCreate();
        return;
      }
      const name = raw.endsWith('.py') || raw.includes('.') ? raw : `${raw}.py`;
      const path = `${projectRoot}/${name}`;
      const content = pending.kind === 'circuit' ? STARTER_TEMPLATES[pending.framework] : '';
      if (pending.kind === 'circuit') setEditorFramework(pending.framework);
      openTab({ path, content });
      cancelCreate();
      return;
    }

    if (pending.kind === 'folder') {
      const path = `${projectRoot}/${raw}`;
      const res = await platform.createDirectory(path, false);
      cancelCreate();
      if (!res) { setError(`Couldn't create folder ${raw}.`); return; }
      await reloadTree(projectRoot);
      return;
    }

    if (pending.kind === 'package') {
      const path = `${projectRoot}/${raw}`;
      const dir = await platform.createDirectory(path, false);
      if (!dir) { setError(`Couldn't create package ${raw}.`); cancelCreate(); return; }
      await platform.createFile(`${path}/__init__.py`, '');
      cancelCreate();
      await reloadTree(projectRoot);
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
    await reloadTree(projectRoot);
    openTab({ path: res.path, content });
    setFocusedPath(res.path);
  }, [draft, pending, projectRoot, platform, reloadTree, openTab, setEditorFramework]);

  const commitRename = useCallback(
    async (oldPath: string) => {
      const d = renameDraft.trim();
      setRenameTarget(null);
      if (!d || d === basename(oldPath)) return;
      const res = await platform.renameFile(oldPath, d);
      if (res) {
        useProjectStore.getState().renameTab(oldPath, res.path);
        if (projectRoot) void reloadTree(projectRoot);
      }
    },
    [renameDraft, platform, projectRoot, reloadTree],
  );

  const rowStyle = (isActive: boolean, depth: number): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    padding: `3px 8px 3px ${8 + depth * 12}px`,
    fontSize: 12,
    fontFamily: TYPOGRAPHY.fontSans,
    color: isActive ? colors.accent : colors.text,
    background: isActive ? `${colors.accent}14` : 'transparent',
    // Accent left bar on the open file — same signal as the tabs and the
    // Open Files list, so the active file is unmistakable in all three.
    boxShadow: isActive ? `inset 2px 0 0 ${colors.accent}` : 'none',
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
            aria-level={depth + 1}
            data-tree-path={entry.path}
            tabIndex={rovingTabIndex(entry.path)}
            onFocus={() => setFocusedPath(entry.path)}
            onClick={() => toggleExpand(entry.path)}
            className="nuclei-row"
            style={rowStyle(false, depth)}
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
              fontFamily: TYPOGRAPHY.fontSans,
            }}
          />
        </div>
      );
    }
    return (
      <div
        key={entry.path}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isActive}
        data-tree-path={entry.path}
        tabIndex={rovingTabIndex(entry.path)}
        onFocus={() => setFocusedPath(entry.path)}
        onClick={() => handleOpenFile(entry.path)}
        onDoubleClick={() => {
          setRenameDraft(entry.name);
          setRenameTarget(entry.path);
        }}
        className="nuclei-row"
        style={rowStyle(isActive, depth)}
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

  const rootName = useMemo(() => {
    if (!projectRoot) return '';
    if (isMemoryPath(projectRoot)) return 'Untitled project';
    return projectRoot.split('/').pop() || projectRoot;
  }, [projectRoot]);

  /**
   * When the project is in-memory (unsaved), the "tree" is just the list
   * of open tabs whose paths live under this memory:// root. There's no
   * filesystem to read, and we deliberately show nothing else.
   */
  const memoryTabEntries: DirEntry[] = useMemo(() => {
    if (!projectRoot || !isMemoryPath(projectRoot)) return [];
    return tabs
      .filter((t) => t.path.startsWith(`${projectRoot}/`))
      .map((t) => ({
        name: t.path.slice(projectRoot.length + 1),
        path: t.path,
        kind: 'file' as const,
      }));
  }, [tabs, projectRoot]);

  const treeEntries: readonly DirEntry[] = inMemory ? memoryTabEntries : rootEntries ?? [];
  const visibleItems = flattenVisible(treeEntries, childEntries, expanded);
  const tabStopPath = visibleItems.some((i) => i.path === focusedPath)
    ? focusedPath
    : visibleItems.find((i) => i.path === activeTabPath)?.path ?? visibleItems[0]?.path ?? null;
  const rovingTabIndex = (path: string): 0 | -1 => (path === tabStopPath ? 0 : -1);

  const focusRow = (path: string) => {
    setFocusedPath(path);
    requestAnimationFrame(() => {
      const rows = treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-path]') ?? [];
      Array.from(rows).find((r) => r.dataset.treePath === path)?.focus();
    });
  };

  const handleTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-tree-path]');
    if (!target || e.target !== target) return;
    const path = target.dataset.treePath as string;
    const action = resolveTreeKey(visibleItems, path, e.key);
    if (action.type === 'none') return;
    e.preventDefault();
    const item = visibleItems.find((i) => i.path === path);
    switch (action.type) {
      case 'focus': focusRow(action.path); break;
      case 'expand': void toggleExpand(action.path); break;
      case 'collapse': setExpanded((cur) => ({ ...cur, [action.path]: false })); break;
      case 'activate':
        if (item?.kind === 'directory') void toggleExpand(action.path);
        else void handleOpenFile(action.path);
        break;
      case 'rename': {
        const name = basename(action.path);
        setRenameDraft(name);
        setRenameTarget(action.path);
        break;
      }
    }
  };


  /**
   * Quick-create from the empty state. Spins up an in-memory project
   * AND opens a starter tab in one click, so a student landing on
   * Nuclei with no project doesn't have to discover "New Project" then
   * find the + menu — they can pick a framework directly.
   */
  const quickCreateCircuit = useCallback(
    (framework: Framework) => {
      const id = Date.now();
      const memRoot = `${MEMORY_PREFIX}project-${id}`;
      setProjectRoot(memRoot);
      platform.setStoredValue('project_root', null).catch(() => {});
      setEditorFramework(framework);
      openTab({
        path: `${memRoot}/${defaultCircuitFileName(framework)}`,
        content: STARTER_TEMPLATES[framework],
      });
    },
    [setProjectRoot, platform, setEditorFramework, openTab],
  );

  if (isWeb) {
    return (
      <div
        style={{
          padding: 14,
          color: colors.textDim,
          fontSize: 12,
          fontFamily: TYPOGRAPHY.fontSans,
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
          Start a new quantum project, jump straight into a circuit, or open an
          existing folder.
        </p>
        <Button variant="primary" onClick={handleNewProject} icon={<Plus size={14} />}>
          New Project…
        </Button>
        <div
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: colors.textDim,
            marginTop: 2,
          }}
        >
          Quick start
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" style={{ flex: 1 }} onClick={() => quickCreateCircuit('qiskit')} icon={<AtomIcon size={12} />}>Qiskit</Button>
          <Button size="sm" style={{ flex: 1 }} onClick={() => quickCreateCircuit('cirq')} icon={<AtomIcon size={12} />}>Cirq</Button>
          <Button size="sm" style={{ flex: 1 }} onClick={() => quickCreateCircuit('cuda-q')} icon={<AtomIcon size={12} />}>CUDA-Q</Button>
          <Button size="sm" style={{ flex: 1 }} onClick={() => quickCreateCircuit('qsharp')} icon={<AtomIcon size={12} />}>Q#</Button>
        </div>
        <Button onClick={handleOpenFolder} icon={<FolderOpen size={14} />}>Open Folder…</Button>
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
    fontFamily: TYPOGRAPHY.fontSans,
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
            fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          {rootName}
        </span>
        <div ref={menuContainerRef}>
          <IconButton
            size="sm"
            aria-label="New file, circuit or folder"
            tooltip={{ label: 'New…' }}
            onClick={() => {
              setMenuOpen((o) => !o);
              setCircuitSubmenu(false);
            }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Plus size={14} />
          </IconButton>
          {menuOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                left: 8,
                right: 8,
                top: 'calc(100% + 4px)',
                background: colors.bgPanel,
                border: `1px solid ${colors.borderStrong}`,
                borderRadius: 'var(--radius-round)',
                zIndex: 100,
                overflow: 'visible',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                padding: '4px 0',
              }}
            >
              <button
                className="nuclei-menu-item nuclei-menu-item--tint"
 style={menuItemStyle}
                onClick={() => startCreate({ kind: 'file', initial: 'untitled.py' })}
              >
                <FilePlus size={14} style={{ color: colors.textDim }} /> New File
                <span style={{ marginLeft: 'auto', fontSize: 11, color: colors.textDim }}>.py</span>
              </button>

              <div
                style={{ position: 'relative' }}
                onMouseEnter={() => setCircuitSubmenu(true)}
                onMouseLeave={() => setCircuitSubmenu(false)}
              >
                <button
                  className="nuclei-menu-item nuclei-menu-item--tint"
 style={menuItemStyle}
                  onClick={() => setCircuitSubmenu((s) => !s)}
                >
                  <AtomIcon size={14} style={{ color: colors.accentLight }} /> New Circuit
                  <ChevronRight size={12} style={{ marginLeft: 'auto', color: colors.textDim }} />
                </button>
                {circuitSubmenu && (
                  <div
                    role="menu"
                    style={{ paddingLeft: 12 }}
                  >
                    {(['qiskit', 'cirq', 'cuda-q', 'qsharp'] as Framework[]).map((f) => (
                      <button
                        key={f}
                        className="nuclei-menu-item nuclei-menu-item--tint"
 style={menuItemStyle}
                        onClick={() => startCreate({
                          kind: 'circuit',
                          framework: f,
                          initial: defaultCircuitFileName(f),
                        })}
                      >
                        <AtomIcon size={14} style={{ color: colors.accentLight }} />
                        {displayFrameworkName(f)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ borderTop: `1px solid ${colors.border}`, margin: '4px 0' }} />

              <button
                className="nuclei-menu-item nuclei-menu-item--tint"
 style={menuItemStyle}
                onClick={() => startCreate({ kind: 'package', initial: 'new_package' })}
              >
                <Package size={14} style={{ color: colors.textDim }} /> New Python Package
              </button>
              <button
                className="nuclei-menu-item nuclei-menu-item--tint"
 style={menuItemStyle}
                onClick={() => startCreate({ kind: 'folder', initial: 'new_folder' })}
              >
                <FolderPlus size={14} style={{ color: colors.textDim }} /> New Folder
              </button>
            </div>
          )}
        </div>
        <IconButton size="sm" aria-label="Refresh file list" tooltip={{ label: 'Refresh' }} onClick={handleRefresh}>
          <RefreshCw size={12} />
        </IconButton>
        <IconButton
          size="sm"
          aria-label="Close folder"
          tooltip={{ label: 'Close folder' }}
          onClick={() => {
            setProjectRoot(null);
            platform.setStoredValue('project_root', null).catch(() => {});
          }}
        >
          <X size={13} />
        </IconButton>
      </div>

      {pending && (
        <div style={{ padding: '4px 8px', borderBottom: `1px solid ${colors.border}` }}>
          <div
            style={{
              fontSize: 11,
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
              fontFamily: TYPOGRAPHY.fontSans,
            }}
          />
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading && (
          <div
            style={{
              padding: 14,
              color: colors.textDim,
              fontSize: 12,
              fontFamily: TYPOGRAPHY.fontSans,
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
              fontFamily: TYPOGRAPHY.fontSans,
            }}
          >
            {error}
          </div>
        )}
        <div
          ref={treeRef}
          role="tree"
          aria-label="Project files"
          onKeyDown={handleTreeKeyDown}
        >
        {!loading && !error && inMemory && (
          <>
            <div
              style={{
                padding: '8px 14px 4px',
                color: colors.textDim,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                fontFamily: TYPOGRAPHY.fontSans,
              }}
            >
              Unsaved — ⌘S to save to disk
            </div>
            {memoryTabEntries.map((e) => renderEntry(e, 0))}
            {memoryTabEntries.length === 0 && (
              <div
                style={{
                  padding: 14,
                  color: colors.textDim,
                  fontSize: 12,
                  fontFamily: TYPOGRAPHY.fontSans,
                }}
              >
                Click + to add a file or circuit. ⌘S to save to disk.
              </div>
            )}
          </>
        )}
        {!loading && !error && !inMemory && rootEntries && rootEntries.map((e) => renderEntry(e, 0))}
        {!loading && !error && !inMemory && rootEntries && rootEntries.length === 0 && (
          <div
            style={{
              padding: 14,
              color: colors.textDim,
              fontSize: 12,
              fontFamily: TYPOGRAPHY.fontSans,
            }}
          >
            Folder is empty. Click + to add a file, package, or circuit.
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
