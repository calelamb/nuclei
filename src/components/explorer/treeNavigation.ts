import type { DirEntry } from '../../platform/bridge';

/** One row of the flattened, currently-visible explorer tree. */
export interface VisibleTreeItem {
  path: string;
  kind: DirEntry['kind'];
  depth: number;
  parentPath: string | null;
  expanded: boolean;
}

/** Flatten the tree to the rows that are on screen, in display order. */
export function flattenVisible(
  entries: readonly DirEntry[],
  childEntries: Readonly<Record<string, DirEntry[]>>,
  expanded: Readonly<Record<string, boolean>>,
  depth = 0,
  parentPath: string | null = null,
): VisibleTreeItem[] {
  return entries.flatMap((entry) => {
    const isOpen = entry.kind === 'directory' && !!expanded[entry.path];
    const self: VisibleTreeItem = { path: entry.path, kind: entry.kind, depth, parentPath, expanded: isOpen };
    const children = isOpen ? childEntries[entry.path] ?? [] : [];
    return [self, ...flattenVisible(children, childEntries, expanded, depth + 1, entry.path)];
  });
}

export type TreeAction =
  | { type: 'focus'; path: string }
  | { type: 'expand'; path: string }
  | { type: 'collapse'; path: string }
  | { type: 'activate'; path: string }
  | { type: 'rename'; path: string }
  | { type: 'none' };

const NONE: TreeAction = { type: 'none' };

/** Maps a key press on `currentPath` to the tree action it should trigger (WAI-ARIA tree pattern). */
export function resolveTreeKey(
  items: readonly VisibleTreeItem[],
  currentPath: string,
  key: string,
): TreeAction {
  const index = items.findIndex((i) => i.path === currentPath);
  if (index === -1) return NONE;
  const item = items[index];
  const isDir = item.kind === 'directory';

  switch (key) {
    case 'ArrowDown':
      return index + 1 < items.length ? { type: 'focus', path: items[index + 1].path } : NONE;
    case 'ArrowUp':
      return index > 0 ? { type: 'focus', path: items[index - 1].path } : NONE;
    case 'Home':
      return { type: 'focus', path: items[0].path };
    case 'End':
      return { type: 'focus', path: items[items.length - 1].path };
    case 'ArrowRight':
      if (!isDir) return NONE;
      if (!item.expanded) return { type: 'expand', path: item.path };
      return items[index + 1]?.parentPath === item.path ? { type: 'focus', path: items[index + 1].path } : NONE;
    case 'ArrowLeft':
      if (isDir && item.expanded) return { type: 'collapse', path: item.path };
      return item.parentPath ? { type: 'focus', path: item.parentPath } : NONE;
    case 'Enter':
    case ' ':
      return { type: 'activate', path: item.path };
    case 'F2':
      return isDir ? NONE : { type: 'rename', path: item.path };
    default:
      return NONE;
  }
}
