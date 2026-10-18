// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FileExplorer } from './FileExplorer';
import { PlatformProvider } from '../../platform/PlatformProvider';
import { useProjectStore } from '../../stores/projectStore';
import type { PlatformBridge } from '../../platform/PlatformProvider';

const bridge = {
  getPlatform: () => 'desktop',
  listDirectory: vi.fn(async () => [
    { name: 'circuits', path: '/proj/circuits', kind: 'directory' },
    { name: 'bell.py', path: '/proj/bell.py', kind: 'file' },
  ]),
  getStoredValue: vi.fn(async () => null),
  setStoredValue: vi.fn(async () => undefined),
} as unknown as PlatformBridge;

afterEach(cleanup);

describe('FileExplorer rows (rq-r3-14)', () => {
  it('gives file rows the same leading gutter as a folder chevron so icons line up', async () => {
    useProjectStore.setState({ projectRoot: '/proj' });
    render(<PlatformProvider bridge={bridge}><FileExplorer /></PlatformProvider>);
    const file = await screen.findByText('bell.py');
    const row = file.closest('[role="treeitem"]') as HTMLElement;
    const spacer = row.querySelector('[data-tree-spacer]') as HTMLElement;
    expect(spacer).not.toBeNull();
    expect(spacer.style.width).toBe('12px');
    const folderRow = (await screen.findByText('circuits')).closest('[role="treeitem"]') as HTMLElement;
    expect(folderRow.querySelector('[data-tree-spacer]')).toBeNull();
    expect(folderRow.querySelector('svg')).not.toBeNull();
  });
});

describe('FileExplorer rename (r7-research-02/03)', () => {
  const renameFile = vi.fn();
  const renameBridge = {
    ...bridge,
    listDirectory: vi.fn(async () => [
      { name: 'bell.py', path: '/proj/bell.py', kind: 'file' },
      { name: 'vqe_h2.py', path: '/proj/vqe_h2.py', kind: 'file' },
    ]),
    readFile: vi.fn(async () => ''),
    renameFile,
  } as unknown as PlatformBridge;

  async function setup() {
    useProjectStore.setState({ projectRoot: '/proj', tabs: [], activeTabPath: null });
    render(<PlatformProvider bridge={renameBridge}><FileExplorer /></PlatformProvider>);
    return (await screen.findByText('bell.py')).closest('[role="treeitem"]') as HTMLElement;
  }

  it('opens a file on double-click and never starts a rename', async () => {
    const row = await setup();
    fireEvent.mouseDown(row, { detail: 1 });
    fireEvent.click(row);
    fireEvent.mouseDown(row, { detail: 2 });
    fireEvent.doubleClick(row);
    await waitFor(() => expect(useProjectStore.getState().activeTabPath).toBe('/proj/bell.py'));
    expect(screen.queryByLabelText('Rename bell.py')).toBeNull();
  });

  it('rejects a name that already exists in the folder inline, keeping the input open', async () => {
    const row = await setup();
    row.focus();
    fireEvent.keyDown(row, { key: 'F2' });
    const input = await screen.findByLabelText('Rename bell.py');
    fireEvent.change(input, { target: { value: 'vqe_h2.py' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/already exists/);
    expect(renameFile).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Rename bell.py')).toBeTruthy();
  });

  it('rejects slashes in a rename', async () => {
    const row = await setup();
    row.focus();
    fireEvent.keyDown(row, { key: 'F2' });
    const input = await screen.findByLabelText('Rename bell.py');
    fireEvent.change(input, { target: { value: '/etc/x.py' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/slashes/);
    expect(renameFile).not.toHaveBeenCalled();
  });

  it('reports a failed rename inline instead of silently closing', async () => {
    renameFile.mockResolvedValueOnce(null);
    const row = await setup();
    row.focus();
    fireEvent.keyDown(row, { key: 'F2' });
    const input = await screen.findByLabelText('Rename bell.py');
    fireEvent.change(input, { target: { value: 'ghz.py' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't rename bell\.py/);
  });

  it('returns focus to the row after Escape', async () => {
    const row = await setup();
    row.focus();
    fireEvent.keyDown(row, { key: 'F2' });
    const input = await screen.findByLabelText('Rename bell.py');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-tree-path')).toBe('/proj/bell.py'));
  });

  it('moves focus to the renamed row after a successful rename', async () => {
    renameFile.mockResolvedValueOnce({ path: '/proj/ghz.py' });
    const row = await setup();
    (renameBridge.listDirectory as ReturnType<typeof vi.fn>).mockImplementation(async () => [
      { name: 'ghz.py', path: '/proj/ghz.py', kind: 'file' },
      { name: 'vqe_h2.py', path: '/proj/vqe_h2.py', kind: 'file' },
    ]);
    row.focus();
    fireEvent.keyDown(row, { key: 'F2' });
    const input = await screen.findByLabelText('Rename bell.py');
    fireEvent.change(input, { target: { value: 'ghz.py' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-tree-path')).toBe('/proj/ghz.py'));
  });
});
