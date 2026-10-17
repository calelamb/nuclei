// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlatformProvider } from '../../../platform/PlatformProvider';
import type { PlatformBridge } from '../../../platform/bridge';
import { useProjectStore } from '../../../stores/projectStore';
import { QecSourcesPanel } from './QecSourcesPanel';
import { resetQecWorkbenchTestState } from './qecWorkbenchTestUtils';

const readFile = vi.fn<(path: string) => Promise<string | null>>();
const bridge = { readFile } as unknown as PlatformBridge;

function renderPanel() {
  return render(<PlatformProvider bridge={bridge}><QecSourcesPanel /></PlatformProvider>);
}

const sourceRow = (): HTMLElement => screen.getByText('circuit-d7').closest('button') as HTMLElement;

beforeEach(() => {
  resetQecWorkbenchTestState();
  useProjectStore.setState({ projectRoot: '/project', tabs: [], activeTabPath: null });
  readFile.mockReset();
});
afterEach(cleanup);

describe('opening a .stim source (qec-r-04)', () => {
  it('opens the circuit as an editor tab on double-click', async () => {
    readFile.mockResolvedValue('H 0\nM 0\n');
    renderPanel();
    fireEvent.doubleClick(sourceRow());
    await waitFor(() => expect(useProjectStore.getState().activeTabPath).toBe('/project/circuits/surface-d7.stim'));
    expect(readFile).toHaveBeenCalledWith('/project/circuits/surface-d7.stim');
    expect(useProjectStore.getState().tabs[0].content).toBe('H 0\nM 0\n');
  });

  it('opens on Enter and from the Open circuit button', async () => {
    readFile.mockResolvedValue('X 0');
    renderPanel();
    fireEvent.keyDown(sourceRow(), { key: 'Enter' });
    await waitFor(() => expect(useProjectStore.getState().tabs).toHaveLength(1));
    useProjectStore.setState({ tabs: [], activeTabPath: null });
    fireEvent.click(screen.getByRole('button', { name: 'Open circuit-d7' }));
    await waitFor(() => expect(useProjectStore.getState().tabs).toHaveLength(1));
  });

  it('tells the person when the file cannot be read instead of failing silently', async () => {
    readFile.mockResolvedValue(null);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Open circuit-d7' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not open surface-d7\.stim/);
    expect(useProjectStore.getState().tabs).toHaveLength(0);
  });

  it('offers no Open button for sources that are not editor files', () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Open campaign-a' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open circuit-d7' })).toBeTruthy();
  });
});
