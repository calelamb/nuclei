# Plan 5 — Zero-Ceremony Project Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Nuclei from a single-file editor into a real project IDE. Any folder on disk is a valid Nuclei project — no manifest required. Multiple tabs, persistent across sessions, inline rename, dirty-close confirm. Desktop-first; web gracefully falls back to single-file mode.

**Architecture:** Extend `PlatformBridge` with directory-level ops. Rewrite `projectStore` so tabs have per-tab buffers and dirty state. Monaco swaps its buffer when the active tab changes. `FileExplorer` becomes a real tree view reading from disk. Simple toolbar in the sidebar header exposes Open Folder / New File. No file watcher in v1 — manual refresh button for externally-modified files.

**Tech Stack:** React 19 + TypeScript + Zustand + Monaco + Tauri `@tauri-apps/plugin-fs` + `@tauri-apps/plugin-dialog`.

**Branch:** `feat/project-management` cut from `preview/ai-native` (so it contains all four prior plans).

**Source spec:** Design from the gap analysis conversation — zero-ceremony, any folder is a project, deferred: watcher / ⌘P / drag-drop / recent list / GitHub import.

---

## Task 1: Cut branch + baseline

- [ ] Step 1

```bash
cd "/Users/calelamb/Desktop/personal projects/nuclei"
git checkout -b feat/project-management preview/ai-native
```

- [ ] Step 2: baseline

```bash
npm test -- --run
```

Expected: 77 pass.

---

## Task 2: Extend PlatformBridge

**Files:**
- Modify: `src/platform/bridge.ts`
- Modify: `src/platform/tauriBridge.ts`
- Modify: `src/platform/webBridge.ts`

Add directory + file CRUD.

- [ ] Step 1: Extend interface

In `bridge.ts`, add:

```typescript
export interface DirEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
}

export interface PlatformBridge {
  // ... existing methods ...

  // Project / directory ops (desktop-primary). Web implementations should
  // return null (or the sentinel 'unsupported' for list/write ops) to
  // indicate that the current surface doesn't support folder projects.
  openDirectory(): Promise<{ path: string } | null>;
  listDirectory(path: string): Promise<DirEntry[] | null>;
  createFile(path: string, content: string): Promise<{ path: string } | null>;
  deleteFile(path: string): Promise<boolean>;
}
```

- [ ] Step 2: Tauri implementation

In `tauriBridge.ts`, add (using the already-installed `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-fs`):

```typescript
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readDir, writeTextFile, remove, exists, BaseDirectory } from '@tauri-apps/plugin-fs';

// in tauriBridge object:

  async openDirectory() {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected !== 'string') return null;
      return { path: selected };
    } catch { return null; }
  },

  async listDirectory(path: string) {
    try {
      const entries = await readDir(path);
      return entries
        .filter((e) => {
          // Skip hidden files and obvious noise.
          if (e.name?.startsWith('.')) return false;
          if (e.name === 'node_modules' || e.name === '__pycache__') return false;
          return true;
        })
        .map((e) => ({
          name: e.name ?? '',
          path: `${path}/${e.name}`,
          kind: e.isDirectory ? 'directory' as const : 'file' as const,
        }))
        .sort((a, b) => {
          // Folders first, then alphabetical.
          if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch { return null; }
  },

  async createFile(path: string, content: string) {
    try {
      // Check if it already exists — refuse to overwrite silently.
      if (await exists(path)) return null;
      await writeTextFile(path, content);
      return { path };
    } catch { return null; }
  },

  async deleteFile(path: string) {
    try {
      await remove(path);
      return true;
    } catch { return false; }
  },
```

If `readDir`'s return shape in your installed Tauri plugin version differs from `{ name, isDirectory }`, adapt the mapping to whatever `@tauri-apps/plugin-fs` 2.5 exposes.

- [ ] Step 3: Web stub implementation

In `webBridge.ts`, add:

```typescript
  async openDirectory() { return null; },
  async listDirectory() { return null; },
  async createFile() { return null; },
  async deleteFile() { return false; },
```

Web users get the existing single-file flow. A later plan can add File System Access API support + zip import/export; out of scope here.

- [ ] Step 4: Build

```bash
npm run build:web 2>&1 | tail -3
```

Expected: build green.

- [ ] Step 5: Commit

```bash
git add src/platform/bridge.ts src/platform/tauriBridge.ts src/platform/webBridge.ts
git commit -m "feat(bridge): directory ops + file CRUD (desktop impl, web stubs)"
```

---

## Task 3: Rewrite `projectStore` for real tabs (TDD)

**Files:**
- Rewrite: `src/stores/projectStore.ts`
- Create: `src/stores/projectStore.test.ts`

New tab model: each open tab owns its own buffer and dirty state. Activating a tab swaps Monaco's content in/out.

- [ ] Step 1: Write tests

Create `src/stores/projectStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

describe('projectStore tabs', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projectRoot: null,
      tabs: [],
      activeTabPath: null,
    });
  });

  it('starts with no tabs and no active tab', () => {
    const s = useProjectStore.getState();
    expect(s.tabs).toEqual([]);
    expect(s.activeTabPath).toBeNull();
  });

  it('openTab adds a tab and activates it', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    const s = useProjectStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].path).toBe('/p/a.py');
    expect(s.tabs[0].content).toBe('x');
    expect(s.tabs[0].isDirty).toBe(false);
    expect(s.activeTabPath).toBe('/p/a.py');
  });

  it('openTab on an already-open path just reactivates it', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().openTab({ path: '/p/b.py', content: 'y' });
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'stale-ignored' });
    const s = useProjectStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeTabPath).toBe('/p/a.py');
    // Previously-open tab's content is preserved, not overwritten by the reactivation.
    expect(s.tabs.find((t) => t.path === '/p/a.py')?.content).toBe('x');
  });

  it('updateActiveTabContent marks the active tab dirty', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().updateActiveTabContent('x\nprint(1)');
    const tab = useProjectStore.getState().tabs[0];
    expect(tab.content).toBe('x\nprint(1)');
    expect(tab.isDirty).toBe(true);
  });

  it('markTabSaved clears dirty and stores saved content', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().updateActiveTabContent('y');
    useProjectStore.getState().markTabSaved('/p/a.py', 'y');
    const tab = useProjectStore.getState().tabs[0];
    expect(tab.isDirty).toBe(false);
    expect(tab.content).toBe('y');
  });

  it('closeTab removes the tab and picks a neighbor as active', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().openTab({ path: '/p/b.py', content: 'y' });
    useProjectStore.getState().openTab({ path: '/p/c.py', content: 'z' });
    // Active is /p/c.py now; close the middle one
    useProjectStore.getState().closeTab('/p/b.py');
    const s = useProjectStore.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(['/p/a.py', '/p/c.py']);
    expect(s.activeTabPath).toBe('/p/c.py');
  });

  it('closeTab on the active tab picks the previous as new active', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().openTab({ path: '/p/b.py', content: 'y' });
    useProjectStore.getState().closeTab('/p/b.py');
    expect(useProjectStore.getState().activeTabPath).toBe('/p/a.py');
  });

  it('closing the last tab leaves activeTabPath null', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().closeTab('/p/a.py');
    const s = useProjectStore.getState();
    expect(s.tabs).toEqual([]);
    expect(s.activeTabPath).toBeNull();
  });

  it('setProjectRoot updates root and does not clear tabs automatically', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().setProjectRoot('/p');
    expect(useProjectStore.getState().projectRoot).toBe('/p');
    expect(useProjectStore.getState().tabs).toHaveLength(1);
  });

  it('renameTab updates path on a single tab', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    useProjectStore.getState().renameTab('/p/a.py', '/p/aa.py');
    const s = useProjectStore.getState();
    expect(s.tabs[0].path).toBe('/p/aa.py');
    expect(s.activeTabPath).toBe('/p/aa.py');
  });

  it('hasAnyDirty returns true when any tab is dirty', () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'x' });
    expect(useProjectStore.getState().hasAnyDirty()).toBe(false);
    useProjectStore.getState().updateActiveTabContent('y');
    expect(useProjectStore.getState().hasAnyDirty()).toBe(true);
  });
});
```

- [ ] Step 2: RED

```bash
npm test -- --run src/stores/projectStore.test.ts
```

- [ ] Step 3: Replace `projectStore.ts`

Replace the entire file with:

```typescript
import { create } from 'zustand';

export interface ProjectTab {
  path: string;
  content: string;
  savedContent: string; // last-persisted content — dirty === content !== savedContent
  isDirty: boolean;
}

interface ProjectState {
  projectRoot: string | null;
  tabs: ProjectTab[];
  activeTabPath: string | null;

  setProjectRoot(root: string | null): void;
  openTab(input: { path: string; content: string }): void;
  closeTab(path: string): void;
  setActiveTab(path: string): void;
  updateActiveTabContent(content: string): void;
  markTabSaved(path: string, savedContent: string): void;
  renameTab(oldPath: string, newPath: string): void;
  closeAllTabs(): void;
  hasAnyDirty(): boolean;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectRoot: null,
  tabs: [],
  activeTabPath: null,

  setProjectRoot: (projectRoot) => set({ projectRoot }),

  openTab: ({ path, content }) => set((s) => {
    const existing = s.tabs.find((t) => t.path === path);
    if (existing) {
      return { activeTabPath: path };
    }
    const tab: ProjectTab = {
      path,
      content,
      savedContent: content,
      isDirty: false,
    };
    return {
      tabs: [...s.tabs, tab],
      activeTabPath: path,
    };
  }),

  closeTab: (path) => set((s) => {
    const idx = s.tabs.findIndex((t) => t.path === path);
    if (idx < 0) return s;
    const tabs = [...s.tabs.slice(0, idx), ...s.tabs.slice(idx + 1)];
    let activeTabPath = s.activeTabPath;
    if (activeTabPath === path) {
      // Prefer the previous neighbor, fall back to next, fall back to null.
      const newActive = tabs[idx - 1] ?? tabs[idx] ?? null;
      activeTabPath = newActive ? newActive.path : null;
    }
    return { tabs, activeTabPath };
  }),

  setActiveTab: (path) => set((s) => {
    if (!s.tabs.some((t) => t.path === path)) return s;
    return { activeTabPath: path };
  }),

  updateActiveTabContent: (content) => set((s) => ({
    tabs: s.tabs.map((t) =>
      t.path === s.activeTabPath
        ? { ...t, content, isDirty: content !== t.savedContent }
        : t,
    ),
  })),

  markTabSaved: (path, savedContent) => set((s) => ({
    tabs: s.tabs.map((t) =>
      t.path === path ? { ...t, savedContent, content: savedContent, isDirty: false } : t,
    ),
  })),

  renameTab: (oldPath, newPath) => set((s) => ({
    tabs: s.tabs.map((t) => (t.path === oldPath ? { ...t, path: newPath } : t)),
    activeTabPath: s.activeTabPath === oldPath ? newPath : s.activeTabPath,
  })),

  closeAllTabs: () => set({ tabs: [], activeTabPath: null }),

  hasAnyDirty: () => get().tabs.some((t) => t.isDirty),
}));
```

- [ ] Step 4: GREEN

```bash
npm test -- --run src/stores/projectStore.test.ts
```

Expected: 10 pass.

- [ ] Step 5: Commit

```bash
git add src/stores/projectStore.ts src/stores/projectStore.test.ts
git commit -m "feat(project): real tab model with per-tab buffers + dirty state"
```

---

## Task 4: Sync active tab into `editorStore`

**Files:**
- Modify: `src/stores/editorStore.ts`
- Modify: `src/App.tsx` (or `QuantumEditor.tsx`) — whichever owns the editor-to-store wiring

The editor still reads `code` / `filePath` / `isDirty` from `editorStore`. We bridge: active-tab change → copy that tab's content into `editorStore`. Editor content change → `updateActiveTabContent`.

- [ ] Step 1: Add a bridge hook

Create `src/hooks/useActiveTabSync.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';

/**
 * Two-way sync between `projectStore` (the source of truth for all tabs)
 * and `editorStore` (a single-file store that Monaco + AI services already
 * read from). Activating a tab copies its buffer into editorStore; editing
 * the buffer in editorStore pushes back into the active tab.
 *
 * Existing features (useFileOps save-on-⌘S, kernel context, Dirac chat) keep
 * reading from `editorStore` unchanged. projectStore is the new authority.
 */
export function useActiveTabSync() {
  const activeTabPath = useProjectStore((s) => s.activeTabPath);
  const activeTab = useProjectStore((s) =>
    s.tabs.find((t) => t.path === s.activeTabPath) ?? null,
  );
  const updateActiveTabContent = useProjectStore((s) => s.updateActiveTabContent);
  const code = useEditorStore((s) => s.code);
  const setCode = useEditorStore((s) => s.setCode);
  const setFilePath = useEditorStore((s) => s.setFilePath);
  const setIsDirty = useEditorStore((s) => s.setIsDirty);

  const lastAppliedPath = useRef<string | null>(null);

  // Tab activation → load its content into editorStore.
  useEffect(() => {
    if (!activeTab) {
      if (lastAppliedPath.current !== null) {
        lastAppliedPath.current = null;
        setCode('');
        setFilePath(null);
        setIsDirty(false);
      }
      return;
    }
    if (lastAppliedPath.current !== activeTab.path) {
      lastAppliedPath.current = activeTab.path;
      setCode(activeTab.content);
      setFilePath(activeTab.path);
      setIsDirty(activeTab.isDirty);
    } else {
      // Same tab still active — keep dirty in sync with the tab model.
      setIsDirty(activeTab.isDirty);
    }
  }, [activeTab, setCode, setFilePath, setIsDirty]);

  // Editor content change → write back into the active tab.
  useEffect(() => {
    if (!activeTabPath) return;
    if (activeTab && code !== activeTab.content) {
      updateActiveTabContent(code);
    }
    // Intentionally excluding activeTab from deps to avoid a ping-pong loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, activeTabPath, updateActiveTabContent]);
}
```

- [ ] Step 2: Ensure `editorStore` has a `setIsDirty` setter

If `setIsDirty` isn't exported, add it. Grep to confirm:

```bash
grep -n "setIsDirty\|isDirty:" src/stores/editorStore.ts
```

If missing, add to the state/initializer:

```typescript
setIsDirty: (isDirty: boolean) => void;
// and in the initializer:
setIsDirty: (isDirty) => set({ isDirty }),
```

- [ ] Step 3: Call the sync hook from `App.tsx`

Inside `AppInner`, add:

```tsx
import { useActiveTabSync } from './hooks/useActiveTabSync';
// inside AppInner, near the top after the other hook calls:
useActiveTabSync();
```

- [ ] Step 4: Build + test

```bash
npm test -- --run && npm run build:web 2>&1 | tail -3
```

- [ ] Step 5: Commit

```bash
git add src/hooks/useActiveTabSync.ts src/stores/editorStore.ts src/App.tsx
git commit -m "feat(project): bridge active tab into editorStore"
```

---

## Task 5: Multi-tab bar in the editor pane

**Files:**
- Modify: `src/components/editor/EditorTabs.tsx`

Render all open tabs with per-tab dirty dot + close button. Middle-click closes. Click activates. The existing Framework selector + Run button stay on the right side of the bar.

- [ ] Step 1: Rewrite `EditorTabs`

Replace the body of the existing file (keep imports; add projectStore import):

```tsx
import { useProjectStore } from '../../stores/projectStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useThemeStore } from '../../stores/themeStore';
import { useEditorStore } from '../../stores/editorStore';
import { X, FileCode, Play, Loader2 } from 'lucide-react';
import { getExecute } from '../../App';
import { FrameworkSelector } from './FrameworkSelector';

export function EditorTabs() {
  const tabs = useProjectStore((s) => s.tabs);
  const activeTabPath = useProjectStore((s) => s.activeTabPath);
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const closeTabInStore = useProjectStore((s) => s.closeTab);
  const legacyFilePath = useEditorStore((s) => s.filePath);
  const legacyIsDirty = useEditorStore((s) => s.isDirty);
  const kernelReady = useEditorStore((s) => s.kernelReady);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  // If no project tabs are open (e.g. fresh install before Open Folder),
  // fall back to the legacy single-file display so nothing looks broken.
  const usingLegacy = tabs.length === 0;
  const fileNameOf = (path: string) => path.split('/').pop() ?? 'untitled.py';

  const canRun = kernelReady && !isRunning;
  const handleRun = () => { const e = getExecute(); if (e) e(); };
  const runLabel = isRunning ? 'Running…' : !kernelReady ? 'Loading kernel…' : 'Run';
  const runTitle = isRunning
    ? 'Simulation running'
    : !kernelReady
      ? 'Waiting for Python kernel'
      : 'Run simulation (⌘+Enter)';

  const renderTab = (path: string, isDirty: boolean) => {
    const isActive = path === activeTabPath || (usingLegacy && !!legacyFilePath);
    const name = fileNameOf(path);
    return (
      <div
        key={path}
        role="tab"
        aria-selected={isActive}
        onClick={() => !usingLegacy && setActiveTab(path)}
        onAuxClick={(e) => {
          if (e.button === 1 && !usingLegacy) {
            e.preventDefault();
            closeTabInStore(path);
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
          cursor: usingLegacy ? 'default' : 'pointer',
          maxWidth: 200,
          position: 'relative',
          transition: 'background 120ms ease',
        }}
      >
        <FileCode size={13} style={{ color: isActive ? colors.accent : colors.textDim, flexShrink: 0 }} />
        {isDirty && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: colors.warning,
              flexShrink: 0,
            }}
          />
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        {!usingLegacy && (
          <button
            onClick={(e) => { e.stopPropagation(); closeTabInStore(path); }}
            aria-label={`Close ${name}`}
            title={`Close ${name}`}
            style={{
              background: 'none', border: 'none', padding: 2,
              color: colors.textDim, cursor: 'pointer',
              display: 'flex', alignItems: 'center', borderRadius: 3, flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgElevated; e.currentTarget.style.color = colors.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textDim; }}
          >
            <X size={12} />
          </button>
        )}
      </div>
    );
  };

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
        {usingLegacy
          ? renderTab(legacyFilePath ?? 'untitled.py', legacyIsDirty)
          : tabs.map((t) => renderTab(t.path, t.isDirty))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <FrameworkSelector />
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center' }}>
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
```

- [ ] Step 2: Build + test

```bash
npm test -- --run && npm run build:web 2>&1 | tail -3
```

- [ ] Step 3: Commit

```bash
git add src/components/editor/EditorTabs.tsx
git commit -m "feat(editor): multi-tab bar with dirty dots + close buttons"
```

---

## Task 6: Real file-tree FileExplorer

**Files:**
- Modify: `src/components/explorer/FileExplorer.tsx`

Replace the in-memory view with a disk-backed tree. Header has an "Open Folder" button (when no project) or the project name + New File + Refresh buttons (when one is open). Click a file → open in a new tab.

- [ ] Step 1: Rewrite FileExplorer

Replace the file contents with:

```tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { FolderOpen, FilePlus, RefreshCw, FileCode, Atom, Braces, FileText, Folder, File as FileIconLucide, ChevronRight, ChevronDown, type LucideIcon } from 'lucide-react';
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

function basename(path: string) {
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

  const loadRoot = useCallback(async (rootPath: string) => {
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
  }, [platform]);

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

  const handleOpenFile = useCallback(async (path: string) => {
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
  }, [tabs, platform, openTab]);

  const toggleExpand = useCallback(async (path: string) => {
    const isOpen = !!expanded[path];
    setExpanded((e) => ({ ...e, [path]: !isOpen }));
    if (!isOpen && !childEntries[path]) {
      const entries = await platform.listDirectory(path);
      if (entries) setChildEntries((c) => ({ ...c, [path]: entries }));
    }
  }, [expanded, childEntries, platform]);

  const handleNewFile = useCallback(async () => {
    const name = newFileName.trim();
    if (!name || !projectRoot) {
      setNewFileMode(false);
      setNewFileName('');
      return;
    }
    const safe = name.endsWith('.py') ? name : `${name}.py`;
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

  const commitRename = useCallback(async (oldPath: string) => {
    const draft = renameDraft.trim();
    setRenameTarget(null);
    if (!draft || draft === basename(oldPath)) return;
    const res = await platform.renameFile(oldPath, draft);
    if (res) {
      useProjectStore.getState().renameTab(oldPath, res.path);
      if (projectRoot) loadRoot(projectRoot);
    }
  }, [renameDraft, platform, projectRoot, loadRoot]);

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
            onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgElevated; }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isActive ? `${colors.accent}10` : 'transparent';
            }}
          >
            {isExpanded ? <ChevronDown size={12} style={{ color: colors.textDim, marginRight: 2 }} /> : <ChevronRight size={12} style={{ color: colors.textDim, marginRight: 2 }} />}
            {iconFor(entry.name, true, colors.textMuted)}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
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
              if (e.key === 'Enter') { e.preventDefault(); commitRename(entry.path); }
              if (e.key === 'Escape') { setRenameTarget(null); }
            }}
            style={{
              flex: 1, background: colors.bgElevated, border: `1px solid ${colors.accent}`,
              color: colors.text, fontSize: 12, padding: '2px 6px', borderRadius: 4, outline: 'none',
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
        onDoubleClick={() => { setRenameDraft(entry.name); setRenameTarget(entry.path); }}
        style={rowStyle(isActive, depth)}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = colors.bgElevated; }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = isActive ? `${colors.accent}10` : 'transparent';
        }}
      >
        {iconFor(entry.name, false, isActive ? colors.accent : colors.textMuted)}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
      <div style={{ padding: 14, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif", lineHeight: 1.6 }}>
        Folder projects are a desktop-only feature right now. Download Nuclei from{' '}
        <a href="https://getnuclei.dev" style={{ color: colors.accent }}>getnuclei.dev</a>{' '}
        to open a whole lecture folder. You can still use the editor and simulate circuits here.
      </div>
    );
  }

  if (!projectRoot) {
    return (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ color: colors.textMuted, fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          Open a folder to start a project. Any folder works — no config file required.
        </p>
        <button
          onClick={handleOpenFolder}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
            padding: '7px 12px', background: colors.accent, color: '#0a0f1a',
            border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif", cursor: 'pointer',
          }}
        >
          <FolderOpen size={13} /> Open Folder…
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '6px 10px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        <span
          title={projectRoot}
          style={{
            flex: 1, fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: 0.5, color: colors.textMuted, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          {rootName}
        </span>
        <button
          title="New file"
          onClick={() => { setNewFileMode(true); setNewFileName(''); }}
          style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', padding: 4, display: 'flex', borderRadius: 4 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; e.currentTarget.style.background = colors.bgElevated; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; e.currentTarget.style.background = 'transparent'; }}
        >
          <FilePlus size={13} />
        </button>
        <button
          title="Refresh"
          onClick={handleRefresh}
          style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', padding: 4, display: 'flex', borderRadius: 4 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; e.currentTarget.style.background = colors.bgElevated; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; e.currentTarget.style.background = 'transparent'; }}
        >
          <RefreshCw size={12} />
        </button>
        <button
          title="Close folder"
          onClick={() => { setProjectRoot(null); platform.setStoredValue('project_root', null).catch(() => {}); }}
          style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', padding: 4, fontSize: 11, fontFamily: "'Geist Sans', sans-serif" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
        >
          ×
        </button>
      </div>

      {/* Inline new-file input */}
      {newFileMode && (
        <div style={{ padding: '4px 8px', borderBottom: `1px solid ${colors.border}` }}>
          <input
            autoFocus
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onBlur={handleNewFile}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleNewFile(); }
              if (e.key === 'Escape') { setNewFileMode(false); setNewFileName(''); }
            }}
            placeholder="filename.py"
            style={{
              width: '100%', background: colors.bgElevated, border: `1px solid ${colors.accent}`,
              color: colors.text, fontSize: 12, padding: '4px 8px', borderRadius: 4, outline: 'none',
              fontFamily: "'Geist Sans', sans-serif",
            }}
          />
        </div>
      )}

      {/* Tree */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <div style={{ padding: 14, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>Loading…</div>
        )}
        {error && (
          <div style={{ padding: 14, color: colors.error, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>{error}</div>
        )}
        {!loading && !error && rootEntries && rootEntries.map((e) => renderEntry(e, 0))}
        {!loading && !error && rootEntries && rootEntries.length === 0 && (
          <div style={{ padding: 14, color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
            Folder is empty. Click the + to add a file.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] Step 2: Build

```bash
npm run build:web 2>&1 | tail -3
```

- [ ] Step 3: Commit

```bash
git add src/components/explorer/FileExplorer.tsx
git commit -m "feat(explorer): disk-backed file tree with Open Folder + inline new/rename"
```

---

## Task 7: Dirty-close confirm modal

**Files:**
- Create: `src/components/dialogs/UnsavedChangesModal.tsx`
- Modify: `src/components/editor/EditorTabs.tsx` — intercept close for dirty tabs
- Modify: `src/App.tsx` — mount the modal at root

- [ ] Step 1: Create the modal component

```tsx
import { useDialogStore } from '../../stores/dialogStore';
import { useThemeStore } from '../../stores/themeStore';

export function UnsavedChangesModal() {
  const pending = useDialogStore((s) => s.pendingClose);
  const clearPending = useDialogStore((s) => s.clearPendingClose);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  if (!pending) return null;

  const { fileName, onSave, onDontSave, onCancel } = pending;

  return (
    <>
      <div
        role="presentation"
        onClick={() => { onCancel(); clearPending(); }}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9998 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', top: '32vh', left: '50%', transform: 'translateX(-50%)',
          width: 'min(440px, 92vw)',
          background: colors.bgPanel, border: `1px solid ${colors.borderStrong}`,
          borderRadius: 12, boxShadow: shadow.lg, padding: 18, zIndex: 9999,
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
          Save changes to {fileName}?
        </div>
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16, lineHeight: 1.5 }}>
          Your unsaved edits will be lost if you don't save.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => { onCancel(); clearPending(); }}
            style={{
              background: 'transparent', color: colors.text,
              border: `1px solid ${colors.border}`, borderRadius: 8,
              padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 500,
            }}
          >Cancel</button>
          <button
            onClick={async () => { await onDontSave(); clearPending(); }}
            style={{
              background: 'transparent', color: colors.error,
              border: `1px solid ${colors.border}`, borderRadius: 8,
              padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 500,
            }}
          >Don't save</button>
          <button
            onClick={async () => { await onSave(); clearPending(); }}
            style={{
              background: colors.accent, color: '#0a0f1a',
              border: 'none', borderRadius: 8,
              padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >Save</button>
        </div>
      </div>
    </>
  );
}
```

- [ ] Step 2: Create the tiny `dialogStore`

Create `src/stores/dialogStore.ts`:

```typescript
import { create } from 'zustand';

export interface PendingClose {
  fileName: string;
  onSave: () => Promise<void> | void;
  onDontSave: () => Promise<void> | void;
  onCancel: () => void;
}

interface DialogState {
  pendingClose: PendingClose | null;
  requestClose: (p: PendingClose) => void;
  clearPendingClose: () => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  pendingClose: null,
  requestClose: (p) => set({ pendingClose: p }),
  clearPendingClose: () => set({ pendingClose: null }),
}));
```

- [ ] Step 3: Mount in `App.tsx`

```tsx
import { UnsavedChangesModal } from './components/dialogs/UnsavedChangesModal';
// inside the return:
<UnsavedChangesModal />
```

- [ ] Step 4: Intercept close in EditorTabs

In the close button's `onClick` (inside `EditorTabs.tsx`), replace the call to `closeTabInStore(path)` with a guard:

```typescript
onClick={(e) => {
  e.stopPropagation();
  const tab = useProjectStore.getState().tabs.find((t) => t.path === path);
  if (tab?.isDirty) {
    useDialogStore.getState().requestClose({
      fileName: basename(path),
      onSave: async () => {
        await getFileOps().saveFile(); // assume single active tab — save then close
        useProjectStore.getState().closeTab(path);
      },
      onDontSave: () => useProjectStore.getState().closeTab(path),
      onCancel: () => {},
    });
  } else {
    useProjectStore.getState().closeTab(path);
  }
}}
```

Add imports: `import { useDialogStore } from '../../stores/dialogStore';` and extract a local `basename` helper:

```typescript
const basename = (p: string) => p.split('/').pop() ?? p;
```

Note: `getFileOps` is the existing global accessor from `App.tsx`.

- [ ] Step 5: Build + test

```bash
npm test -- --run && npm run build:web 2>&1 | tail -3
```

- [ ] Step 6: Commit

```bash
git add src/components/dialogs src/stores/dialogStore.ts src/components/editor/EditorTabs.tsx src/App.tsx
git commit -m "feat(tabs): dirty-close confirm modal"
```

---

## Task 8: Persist last folder + open tabs

**Files:**
- Modify: `src/App.tsx`

Restore `project_root` + per-folder open tabs on startup.

- [ ] Step 1: Extend the bootstrap effect

Inside `AppInner`'s main bootstrap `useEffect` (the one that loads `theme`, `ui_mode`, etc.), add:

```typescript
const storedRoot = await safeGet<string>('project_root');
if (storedRoot) {
  useProjectStore.getState().setProjectRoot(storedRoot);
  const openPaths = await safeGet<string[]>(`project_tabs:${storedRoot}`);
  if (openPaths) {
    for (const p of openPaths) {
      const content = await platform.readFile(p).catch(() => null);
      if (content !== null) {
        useProjectStore.getState().openTab({ path: p, content });
      }
    }
  }
  const activePath = await safeGet<string>(`project_active:${storedRoot}`);
  if (activePath) useProjectStore.getState().setActiveTab(activePath);
}
```

- [ ] Step 2: Add a persistence effect

Elsewhere in `AppInner`:

```typescript
const projectRoot = useProjectStore((s) => s.projectRoot);
const tabs = useProjectStore((s) => s.tabs);
const activeTabPath = useProjectStore((s) => s.activeTabPath);

useEffect(() => {
  if (!projectRoot) return;
  const paths = tabs.map((t) => t.path);
  platform.setStoredValue(`project_tabs:${projectRoot}`, paths).catch(() => {});
  platform.setStoredValue(`project_active:${projectRoot}`, activeTabPath).catch(() => {});
}, [projectRoot, tabs, activeTabPath, platform]);
```

- [ ] Step 3: Test + build

```bash
npm test -- --run && npm run build:web 2>&1 | tail -3
```

- [ ] Step 4: Commit

```bash
git add src/App.tsx
git commit -m "feat(project): persist last folder + open tabs across sessions"
```

---

## Task 9: Validate + push

- [ ] Step 1: Full green

```bash
npm test -- --run && npm run build:web 2>&1 | tail -3
```

- [ ] Step 2: Push branch

```bash
git push -u origin feat/project-management
```

- [ ] Step 3: Update preview branch to include this plan

```bash
git checkout preview/ai-native
git merge --ff-only feat/project-management
git push origin preview/ai-native
```

- [ ] Step 4: Report PR URL

Create or point at the PR: `https://github.com/calelamb/nuclei/pull/new/preview/ai-native`.

---

## Spec coverage self-check

- Zero ceremony: any folder works, no manifest. ✓ Task 6.
- Multiple tabs: ✓ Tasks 3, 4, 5.
- Close tab with confirm: ✓ Task 7.
- Persistence: ✓ Task 8.
- Desktop-first, web graceful fallback: ✓ Task 6 (web shows a download nudge).

## Out of scope

- ⌘P quick-switcher
- File watcher
- Drag-drop from OS into sidebar
- Right-click context menu with move/delete/reveal-in-finder
- Recent projects list
- Nested folder creation via UI
- Project-wide search (⌘⇧F)
