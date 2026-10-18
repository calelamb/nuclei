// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
