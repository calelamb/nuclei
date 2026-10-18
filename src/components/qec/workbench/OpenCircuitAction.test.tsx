// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformProvider } from '../../../platform/PlatformProvider';
import type { PlatformBridge } from '../../../platform/bridge';
import { useNavigationStore } from '../../../stores/navigationStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecStore } from '../../../stores/qecStore';
import { useQecStudyStore } from '../../../services/qecStudyStore';
import { OpenCircuitAction } from './OpenCircuitAction';
import { CIRCUIT_LOAD_TIMEOUT_MS } from './openFeedback';
import { resetQecWorkbenchTestState } from './qecWorkbenchTestUtils';

const readFile = vi.fn<(path: string) => Promise<string | null>>();
const bridge = { readFile } as unknown as PlatformBridge;

/** Only one .stim source, so the card offers the one-click open. */
function singleCircuitStudy(): void {
  const entry = useQecStudyStore.getState().studies[0];
  useQecStudyStore.setState({
    studies: [{ ...entry, study: { ...entry.study, sources: entry.study.sources.filter((s) => s.kind === 'stim') } }],
  });
}

function mount() {
  return render(<PlatformProvider bridge={bridge}><OpenCircuitAction /></PlatformProvider>);
}

async function clickOpen(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Open surface-d7\.stim/ }));
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetQecWorkbenchTestState();
  singleCircuitStudy();
  useProjectStore.setState({ projectRoot: '/project', tabs: [], activeTabPath: null });
  useQecStore.setState({ snapshot: null });
  readFile.mockReset();
  readFile.mockResolvedValue('H 0\n');
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Open circuit feedback (rq-r3-07)', () => {
  it('says the circuit is loading once the file is open, with a way to the editor', async () => {
    mount();
    await clickOpen();
    expect(screen.getByRole('status').textContent).toMatch(/Loading circuit/);
    fireEvent.click(screen.getByRole('button', { name: 'Show in editor' }));
    expect(useNavigationStore.getState().activeView).toBe('files');
  });

  it('explains why nothing arrived when the kernel never sends a circuit', async () => {
    mount();
    await clickOpen();
    act(() => { vi.advanceTimersByTime(CIRCUIT_LOAD_TIMEOUT_MS + 50); });
    expect(screen.getByRole('alert').textContent).toMatch(/Stim may not be available in this kernel/);
    expect(screen.queryByRole('button', { name: /Open surface-d7\.stim/ })).toBeNull();
  });
});
