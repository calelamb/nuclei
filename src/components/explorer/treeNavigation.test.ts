import { describe, expect, it } from 'vitest';
import { flattenVisible, resolveTreeKey } from './treeNavigation';
import type { DirEntry } from '../../platform/bridge';

const root: DirEntry[] = [
  { name: 'src', path: '/p/src', kind: 'directory' },
  { name: 'a.py', path: '/p/a.py', kind: 'file' },
];
const children = { '/p/src': [{ name: 'b.py', path: '/p/src/b.py', kind: 'file' as const }] };

describe('flattenVisible', () => {
  it('hides children of collapsed folders and nests expanded ones', () => {
    expect(flattenVisible(root, children, {}).map((i) => i.path)).toEqual(['/p/src', '/p/a.py']);
    const open = flattenVisible(root, children, { '/p/src': true });
    expect(open.map((i) => [i.path, i.depth])).toEqual([['/p/src', 0], ['/p/src/b.py', 1], ['/p/a.py', 0]]);
  });
});

describe('resolveTreeKey', () => {
  const items = flattenVisible(root, children, { '/p/src': true });
  it('moves with arrows, Home and End', () => {
    expect(resolveTreeKey(items, '/p/src', 'ArrowDown')).toEqual({ type: 'focus', path: '/p/src/b.py' });
    expect(resolveTreeKey(items, '/p/src/b.py', 'ArrowUp')).toEqual({ type: 'focus', path: '/p/src' });
    expect(resolveTreeKey(items, '/p/a.py', 'ArrowDown')).toEqual({ type: 'none' });
    expect(resolveTreeKey(items, '/p/a.py', 'Home')).toEqual({ type: 'focus', path: '/p/src' });
    expect(resolveTreeKey(items, '/p/src', 'End')).toEqual({ type: 'focus', path: '/p/a.py' });
  });
  it('expands, descends, collapses and goes to the parent', () => {
    const closed = flattenVisible(root, children, {});
    expect(resolveTreeKey(closed, '/p/src', 'ArrowRight')).toEqual({ type: 'expand', path: '/p/src' });
    expect(resolveTreeKey(items, '/p/src', 'ArrowRight')).toEqual({ type: 'focus', path: '/p/src/b.py' });
    expect(resolveTreeKey(items, '/p/src', 'ArrowLeft')).toEqual({ type: 'collapse', path: '/p/src' });
    expect(resolveTreeKey(items, '/p/src/b.py', 'ArrowLeft')).toEqual({ type: 'focus', path: '/p/src' });
  });
  it('activates with Enter/Space and renames files with F2', () => {
    expect(resolveTreeKey(items, '/p/a.py', 'Enter')).toEqual({ type: 'activate', path: '/p/a.py' });
    expect(resolveTreeKey(items, '/p/a.py', ' ')).toEqual({ type: 'activate', path: '/p/a.py' });
    expect(resolveTreeKey(items, '/p/a.py', 'F2')).toEqual({ type: 'rename', path: '/p/a.py' });
    expect(resolveTreeKey(items, '/p/src', 'F2')).toEqual({ type: 'none' });
  });
});
