// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FileExplorer } from './FileExplorer';
import { PlatformProvider, type PlatformBridge } from '../../platform/PlatformProvider';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';

const entries = [
  { name: 'bell.py', path: '/proj/bell.py', kind: 'file' as const },
  { name: 'notes', path: '/proj/notes', kind: 'dir' as const },
];

function makeBridge(createFile: PlatformBridge['createFile']) {
  return {
    getPlatform: () => 'desktop',
    listDirectory: vi.fn(async () => entries),
    createFile,
    createDirectory: vi.fn(async () => null),
    getStoredValue: vi.fn(async () => null),
    setStoredValue: vi.fn(async () => undefined),
  } as unknown as PlatformBridge;
}

async function openNewFileInput(bridge: PlatformBridge) {
  useProjectStore.setState({ projectRoot: '/proj', tabs: [] });
  render(<PlatformProvider bridge={bridge}><FileExplorer /></PlatformProvider>);
  await screen.findByText('bell.py');
  fireEvent.click(screen.getByRole('button', { name: 'New file, circuit or folder' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /New file/ }));
  return screen.getByRole('textbox', { name: /name/i }) as HTMLInputElement;
}

afterEach(cleanup);

describe('FileExplorer failed create (research-r-01)', () => {
  it('a duplicate name keeps the tree, keeps the input, and explains inline', async () => {
    const createFile = vi.fn(async () => null);
    const input = await openNewFileInput(makeBridge(createFile));
    fireEvent.change(input, { target: { value: 'bell' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect((await screen.findByRole('alert')).textContent).toMatch(/bell\.py already exists/);
    expect(createFile).not.toHaveBeenCalled();
    expect(screen.getByText('bell.py')).toBeTruthy();
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
  });

  it('a platform refusal also stays beside the input and the tree survives', async () => {
    const input = await openNewFileInput(makeBridge(vi.fn(async () => null)));
    fireEvent.change(input, { target: { value: 'fresh' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Couldn't create fresh\.py/));
    expect(screen.getByText('bell.py')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /name/i })).toBeTruthy();
  });

  it('typing clears the message and Escape still cancels', async () => {
    const input = await openNewFileInput(makeBridge(vi.fn(async () => null)));
    fireEvent.change(input, { target: { value: 'bell' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('alert');
    fireEvent.change(input, { target: { value: 'bel' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: /name/i })).toBeNull();
  });
});

describe('FileExplorer create flow returns focus (interaction-r-05)', () => {
  it('Escape returns focus to the New trigger instead of <body>', async () => {
    const input = await openNewFileInput(makeBridge(vi.fn(async () => null)));
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New file, circuit or folder' })));
  });

  it('a created file hands the keyboard to the editor', async () => {
    const createFile = vi.fn(async (path: string) => ({ path }));
    const input = await openNewFileInput(makeBridge(createFile as never));
    const before = useEditorStore.getState().focusRequest;
    fireEvent.change(input, { target: { value: 'alpha' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    await waitFor(() => expect(useEditorStore.getState().focusRequest).toBe(before + 1));
  });

  it('a created package is expanded and focused in the tree', async () => {
    let created = false;
    const bridge = {
      getPlatform: () => 'desktop',
      listDirectory: vi.fn(async (p: string) => {
        if (p === '/proj/analysis') return [{ name: '__init__.py', path: '/proj/analysis/__init__.py', kind: 'file' as const }];
        return created ? [...entries, { name: 'analysis', path: '/proj/analysis', kind: 'directory' as const }] : entries;
      }),
      createFile: vi.fn(async (path: string) => ({ path })),
      createDirectory: vi.fn(async () => { created = true; return { path: '/proj/analysis' }; }),
      getStoredValue: vi.fn(async () => null),
      setStoredValue: vi.fn(async () => undefined),
    } as unknown as PlatformBridge;
    useProjectStore.setState({ projectRoot: '/proj', tabs: [] });
    render(<PlatformProvider bridge={bridge}><FileExplorer /></PlatformProvider>);
    await screen.findByText('bell.py');
    fireEvent.click(screen.getByRole('button', { name: 'New file, circuit or folder' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Python package/ }));
    const input = screen.getByRole('textbox', { name: /name/i });
    fireEvent.change(input, { target: { value: 'analysis' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    await waitFor(() => {
      const row = screen.getAllByRole('treeitem').find((r) => r.getAttribute('data-tree-path') === '/proj/analysis');
      expect(row?.getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(row);
    });
  });
});

describe('FileExplorer double-click rename (research-r-01)', () => {
  it('does not rename a row the pointer only landed on after the tree moved', async () => {
    useProjectStore.setState({ projectRoot: '/proj', tabs: [] });
    render(<PlatformProvider bridge={makeBridge(vi.fn(async () => null))}><FileExplorer /></PlatformProvider>);
    const row = (await screen.findByText('bell.py')).closest('[role="treeitem"]') as HTMLElement;
    fireEvent.doubleClick(row);
    expect(screen.queryByRole('textbox', { name: /Rename/ })).toBeNull();
    fireEvent.mouseDown(row, { detail: 1 });
    fireEvent.doubleClick(row);
    expect(screen.getByRole('textbox', { name: /Rename/ })).toBeTruthy();
  });
});
