// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformBridge } from '../../platform/bridge';
import { PlatformProvider } from '../../platform/PlatformProvider';
import { useProjectStore } from '../../stores/projectStore';
import { Sidebar } from './Sidebar';

function bridge(platform: 'desktop' | 'web'): PlatformBridge {
  return {
    startKernel: vi.fn(async () => 'ok'), stopKernel: vi.fn(async () => 'ok'),
    openFile: vi.fn(async () => null), readFile: vi.fn(async () => null),
    saveFile: vi.fn(async () => undefined), saveFileAs: vi.fn(async () => null),
    renameFile: vi.fn(async () => null), getStoredValue: vi.fn(async () => null),
    setStoredValue: vi.fn(async () => undefined), setWindowTitle: vi.fn(async () => undefined),
    getPlatform: () => platform, openDirectory: vi.fn(async () => null),
    listDirectory: vi.fn(async () => null), createFile: vi.fn(async () => null),
    createDirectory: vi.fn(async () => null), deleteFile: vi.fn(async () => false),
  };
}

beforeEach(() => {
  useProjectStore.setState({ projectRoot: null, tabs: [], activeTabPath: null });
});

afterEach(() => cleanup());

describe('<Sidebar> QEC integration', () => {
  it('renders the QEC Study surface through the read-only web filesystem adapter', async () => {
    render(
      <PlatformProvider bridge={bridge('web')}>
        <Sidebar view="qec" width={260} onWidthChange={vi.fn()} />
      </PlatformProvider>,
    );

    expect(screen.getByText('QEC Workbench')).toBeTruthy();
    expect(await screen.findByText('Open a project to manage QEC Studies.')).toBeTruthy();
  });

  it('provides interactive search focus and clamps drag resizing', () => {
    const onWidthChange = vi.fn();
    const { container } = render(
      <PlatformProvider bridge={bridge('desktop')}>
        <Sidebar view="search" width={240} onWidthChange={onWidthChange} />
      </PlatformProvider>,
    );
    const input = screen.getByRole('textbox', { name: 'Search files' });
    fireEvent.focus(input);
    fireEvent.blur(input);

    const resizeHandle = container.querySelector('[style*="col-resize"]');
    expect(resizeHandle).toBeTruthy();
    fireEvent.mouseDown(resizeHandle as Element, { clientX: 100 });
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 })));
    expect(onWidthChange).toHaveBeenLastCalledWith(400);
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
  });
});
