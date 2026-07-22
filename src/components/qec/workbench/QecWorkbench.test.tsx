// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQecStudyStore } from '../../../services/qecStudyStore';
import { PlatformProvider } from '../../../platform/PlatformProvider';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecJobStore } from '../../../stores/qecJobStore';
import { useQecQueryStore } from '../../../stores/qecQueryStore';
import { useQecSessionCatalogStore } from '../../../stores/qecSessionCatalogStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import {
  EMPTY_RESEARCH_SELECTION,
  useResearchSelectionStore,
} from '../../../stores/researchSelectionStore';
import { QecWorkbench } from './QecWorkbench';
import { QecSourcesPanel } from './QecSourcesPanel';
import { QecWorkbenchTray } from './QecWorkbenchTray';
import { QecDataClientError, type QecImportClient } from '../../../services/qecDataClient';
import type { QecSession } from '../../../types/qecData';
import { deferred, flushAsync, flushPersistenceDebounce, MemoryStorage,
  persistedState, persistenceBridge } from './qecWorkbenchTestUtils';

const STUDY = {
  schema: 1 as const,
  id: 'surface-memory',
  name: 'Surface Memory',
  question: 'Which decoder reduces logical error?',
  preset: 'build' as const,
  tags: ['memory'],
  sources: [
    { id: 'circuit-d7', kind: 'stim' as const, path: 'circuits/surface-d7.stim' },
    { id: 'campaign-a', kind: 'experiment' as const, path: 'experiments/memory.experiment.yaml' },
  ],
};

const SECOND_STUDY = {
  ...STUDY,
  id: 'decoder-study',
  name: 'Decoder Study',
  question: 'Which decoder has the best tail latency?',
  preset: 'analyze' as const,
  sources: [],
};

const STUDY_UI_ACTIONS = {
  clearActiveStudy: useQecStudyUiStore.getState().clearActiveStudy,
  setActiveStudy: useQecStudyUiStore.getState().setActiveStudy,
};

function setStudies(studies = [STUDY, SECOND_STUDY]): void {
  useQecStudyStore.setState({
    projectRoot: '/project',
    studies: studies.map((study) => ({
      fileName: `${study.id}.qec-study.yaml`,
      path: `studies/${study.id}.qec-study.yaml`,
      study,
    })),
    validationErrors: [],
    loading: false,
  });
}

function importClient(): QecImportClient {
  return {
    probe: vi.fn(async () => ({ type: 'import_probe_result', requestId: 'p', sourcePolicy: 'copy', sourceByteSize: 1, results: [] })),
    validate: vi.fn(), preview: vi.fn(), startImport: vi.fn(), cancel: vi.fn(async () => true),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  useProjectStore.setState({ projectRoot: null, tabs: [], activeTabPath: null });
  setStudies([STUDY]);
  useQecStudyUiStore.setState({ activeStudyId: STUDY.id, ...STUDY_UI_ACTIONS });
  useQecWorkbenchStore.setState({
    preset: 'build',
    pinnedPanelIds: [],
    sourceWidth: 280,
    inspectorWidth: 360,
    trayHeight: 260,
    trayCollapsed: false,
    persistenceError: null,
    persistenceIssue: null,
  });
  useResearchSelectionStore.setState({
    past: [],
    present: EMPTY_RESEARCH_SELECTION,
    future: [],
  });
  useQecJobStore.getState().reset();
  useQecQueryStore.getState().reset();
  useQecSessionCatalogStore.getState().reset();
});

describe('<QecWorkbench />', () => {
  it('renders engine-backed canonical sessions as an accessible selectable list', () => {
    useProjectStore.setState({ projectRoot: '/project' });
    useQecSessionCatalogStore.setState({
      projectRoot: '/project', status: 'ready', error: null,
      sessions: [{
        session_id: 'minimal-capture', kind: 'hardware_import', status: 'complete',
        provenance_id: 'provenance-minimal', adapter: { id: 'stim-results', version: '1' },
      } as QecSession],
    });

    render(<QecSourcesPanel />);

    const list = screen.getByRole('list', { name: 'Canonical sessions' });
    const item = within(list).getByRole('button', { name: /minimal-capture/i });
    expect(item.textContent).toMatch(/hardware import/i);
    expect(item.textContent).toMatch(/complete/i);
    expect(item.textContent).toMatch(/provenance-minimal/i);
    fireEvent.click(item);
    expect(useResearchSelectionStore.getState().present.primary).toEqual({
      kind: 'session', id: 'minimal-capture', sessionId: 'minimal-capture',
    });
  });
  it('renders four named regions and moves between presets', () => {
    render(<QecWorkbench />);

    const sources = screen.getByRole('navigation', { name: 'QEC sources and data' });
    const canvas = screen.getByRole('main', { name: 'QEC investigation canvas' });
    const inspector = screen.getByRole('complementary', { name: 'Research inspector' });
    const tray = screen.getByRole('region', { name: 'QEC jobs and streams' });
    const isBefore = (first: Element, second: Element): boolean =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(isBefore(sources, canvas)).toBe(true);
    expect(isBefore(canvas, inspector)).toBe(true);
    expect(isBefore(inspector, tray)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(useQecWorkbenchStore.getState().preset).toBe('analyze');
    expect(screen.getByRole('button', { name: 'Analyze' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('uses the active Study and panel registry to populate shell instruments', () => {
    render(<QecWorkbench />);

    expect(screen.getByRole('combobox', { name: 'Active QEC Study' })).toHaveProperty(
      'value',
      STUDY.id,
    );
    const canvas = screen.getByRole('main', { name: 'QEC investigation canvas' });
    expect(within(canvas).getByText('Timeline')).toBeTruthy();
    expect(within(canvas).getByText('Code Lattice')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(within(canvas).getByText('Campaign Center')).toBeTruthy();
  });

  it('keeps a pinned canvas instrument visible across preset changes and can unpin it', () => {
    render(<QecWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    const pin = screen.getByRole('button', { name: 'Pin Campaign Center' });
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pin);
    expect(useQecWorkbenchStore.getState().pinnedPanelIds).toEqual(['campaign-center']);

    fireEvent.click(screen.getByRole('button', { name: 'Build' }));
    expect(screen.getByText('Campaign Center')).toBeTruthy();
    const unpin = screen.getByRole('button', { name: 'Unpin Campaign Center' });
    expect(unpin.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(unpin);
    expect(screen.queryByText('Campaign Center')).toBeNull();
  });

  it('persists keyboard resizing for sources, inspector, and tray', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const writes: unknown[] = [];
    const bridge = persistenceBridge(
      vi.fn(async () => null),
      vi.fn(async (_key, value) => { writes.push(value); }),
    );
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize sources panel' }), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize research inspector' }), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize jobs tray' }), { key: 'ArrowUp' });
    expect(useQecWorkbenchStore.getState()).toMatchObject({
      sourceWidth: 296, inspectorWidth: 376, trayHeight: 276,
    });

    await flushPersistenceDebounce();
    expect(writes.at(-1)).toMatchObject({
      sourceWidth: 296, inspectorWidth: 376, trayHeight: 276,
    });
  });

  it('uses a native labeled Study control and preserves keyboard selection semantics', () => {
    setStudies();
    render(<QecWorkbench />);

    const picker = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Active QEC Study' });
    picker.focus();
    fireEvent.keyDown(picker, { key: 'ArrowDown' });
    fireEvent.change(picker, { target: { value: SECOND_STUDY.id } });

    expect(document.activeElement).toBe(picker);
    expect(useQecStudyUiStore.getState().activeStudyId).toBe(SECOND_STUDY.id);
    expect(picker.value).toBe(SECOND_STUDY.id);
  });

  it('clears Study selection through the explicit UI-store action', () => {
    const clearActiveStudy = vi.fn(STUDY_UI_ACTIONS.clearActiveStudy);
    useQecStudyUiStore.setState({ clearActiveStudy });
    render(<QecWorkbench />);

    fireEvent.change(
      screen.getByRole<HTMLSelectElement>('combobox', { name: 'Active QEC Study' }),
      { target: { value: '' } },
    );

    expect(clearActiveStudy).toHaveBeenCalledOnce();
    expect(useQecStudyUiStore.getState().activeStudyId).toBeNull();
  });

  it('asks for a Study choice when Studies exist but the active id is stale', () => {
    setStudies();
    useQecStudyUiStore.setState({ activeStudyId: 'missing-study' });
    render(<QecWorkbench />);

    expect(screen.getByText('Choose a Study')).toBeTruthy();
    expect(screen.getByText(/Use the Study control/)).toBeTruthy();
    expect(screen.queryByText('No Studies found')).toBeNull();
  });

  it('opens and closes the responsive inspector with Escape and returns focus', () => {
    render(<QecWorkbench />);

    const toggle = screen.getByRole('button', { name: 'Hide research inspector' });
    const inspector = screen.getByRole('complementary', { name: 'Research inspector' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(inspector.id);

    fireEvent.click(within(inspector).getByRole('button', { name: 'Close research inspector' }));
    expect(screen.queryByRole('complementary', { name: 'Research inspector' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show research inspector' })).toBe(document.activeElement);

    fireEvent.click(screen.getByRole('button', { name: 'Show research inspector' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Research inspector' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show research inspector' })).toBe(document.activeElement);
  });

  it('moves backward and forward through the shared Research Trail', () => {
    useResearchSelectionStore.getState().selectPrimary(
      { kind: 'campaign-point', id: 'p=.004' },
      'user',
    );
    useResearchSelectionStore.getState().refineScope(
      { kind: 'detector', id: 'D42' },
      'user',
    );
    render(<QecWorkbench />);

    const trail = screen.getByRole('navigation', { name: 'Research trail' });
    expect(within(trail).getByText('p=.004')).toBeTruthy();
    expect(within(trail).getByText('D42')).toBeTruthy();

    fireEvent.click(within(trail).getByRole('button', { name: 'Back in research trail' }));
    expect(within(trail).queryByText('D42')).toBeNull();
    expect(within(trail).getByRole<HTMLButtonElement>('button', { name: 'Forward in research trail' }).disabled).toBe(false);
  });

  it('renders complete entity identities without duplicate React keys', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useResearchSelectionStore.getState().selectPrimary(
      { kind: 'tick', id: '1', sessionId: 's1', datasetId: 'd1' },
      'user',
    );
    useResearchSelectionStore.getState().refineScope(
      { kind: 'tick', id: '1', sessionId: 's1', datasetId: 'd2' },
      'user',
    );
    render(<QecWorkbench />);

    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(4);
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/i);
    consoleError.mockRestore();
  });

  it('keeps tray lifecycle content available while allowing it to collapse', () => {
    render(<QecWorkbench />);

    const tray = screen.getByRole('region', { name: 'QEC jobs and streams' });
    const toggle = within(tray).getByRole('button', { name: 'Collapse jobs and streams' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(tray).getByText('No active jobs')).toBeTruthy();

    fireEvent.click(toggle);
    expect(useQecWorkbenchStore.getState().trayCollapsed).toBe(true);
    expect(
      within(tray).getByRole('button', { name: 'Expand jobs and streams' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(within(tray).queryByText('No active jobs')).toBeNull();
  });

  it('launches a referenced source import into the durable tray lifecycle', () => {
    useProjectStore.setState({ projectRoot: '/project' });
    useQecWorkbenchStore.setState({ trayCollapsed: true });
    render(<QecWorkbench />);

    fireEvent.click(screen.getByRole('button', { name: 'Import campaign-a' }));

    expect(useQecJobStore.getState().importSource).toBe('experiments/memory.experiment.yaml');
    expect(useQecWorkbenchStore.getState().trayCollapsed).toBe(false);
    expect(screen.getByRole('region', { name: 'QEC jobs and streams' }).textContent).toMatch(/Starting authenticated QEC Data Engine/);
  });

  it('returns focus to the originating source action when the import closes', async () => {
    useProjectStore.setState({ projectRoot: '/project' });
    const client = importClient();
    render(<><QecSourcesPanel /><QecWorkbenchTray client={client} /></>);
    const origin = screen.getByRole('button', { name: 'Import campaign-a' });
    fireEvent.click(origin);
    fireEvent.click(await screen.findByRole('button', { name: 'Close import wizard' }));
    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  it('keeps closed import jobs inspectable and cancellable with source context', async () => {
    useProjectStore.setState({ projectRoot: '/project' });
    useQecJobStore.getState().setProjectScope('/project');
    const client = importClient();
    useQecJobStore.setState({
      jobs: {
        running: {
          id: 'running', kind: 'import', status: 'running', message: 'Import running',
          source: 'captures/run.csv', adapterId: 'tabular', sessionId: 'session-42',
          sessionKind: 'hardware_import', sourceHash: 'a'.repeat(64), provenanceId: 'prov-42',
          sourceByteSize: 2048, projectRoot: '/project',
        },
      },
    });
    render(<QecWorkbenchTray client={client} />);
    expect(screen.getByText('captures/run.csv')).toBeTruthy();
    expect(screen.getByText('session-42')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import running' }));
    await waitFor(() => expect(client.cancel).toHaveBeenCalledWith('import', 'running'));
  });

  it('invalidates old project operations before a replacement client can act on them', async () => {
    useProjectStore.setState({ projectRoot: '/old-project' });
    const oldClient = importClient();
    const replacementClient = importClient();
    const view = render(<QecWorkbenchTray client={oldClient} />);
    await waitFor(() => expect(useQecJobStore.getState().projectRoot).toBe('/old-project'));
    act(() => {
      useQecJobStore.setState({
        importSource: 'captures/old.dets',
        jobs: {
          old: {
            id: 'old', kind: 'import', status: 'running', message: 'Import running',
            source: 'captures/old.dets', projectRoot: '/old-project',
          },
        },
      });
      useQecQueryStore.setState({
        tiles: {
          old: {
            projectRoot: '/old-project', requestId: 'old-query', epoch: 1,
            status: 'loading', progress: 0, message: 'Query running', frames: [], error: null,
          },
        },
      });
      useProjectStore.setState({ projectRoot: '/new-project' });
    });
    view.rerender(<QecWorkbenchTray client={replacementClient} />);

    await waitFor(() => expect(useQecJobStore.getState()).toMatchObject({
      projectRoot: '/new-project', importSource: null, jobs: {},
    }));
    expect(useQecQueryStore.getState()).toMatchObject({ projectRoot: '/new-project', tiles: {} });
    await waitFor(() => {
      expect(oldClient.cancel).toHaveBeenCalledWith('import', 'old');
      expect(oldClient.cancel).toHaveBeenCalledWith('query', 'old-query');
    });
    expect(replacementClient.cancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Import captures/old.dets' })).toBeNull();
  });

  it('drops a dead engine client and retries exactly once per explicit action', async () => {
    useProjectStore.setState({ projectRoot: '/project' });
    let disconnectListener: ((error: QecDataClientError) => void) | undefined;
    const connectedClient = {
      ...importClient(),
      disconnect: vi.fn(),
      subscribeDisconnect: vi.fn((listener: (error: QecDataClientError) => void) => {
        disconnectListener = listener;
        return vi.fn();
      }),
    };
    const replacementClient = {
      ...importClient(),
      disconnect: vi.fn(),
      subscribeDisconnect: vi.fn(() => vi.fn()),
    };
    const connectClient = vi.fn()
      .mockResolvedValueOnce(connectedClient)
      .mockResolvedValueOnce(replacementClient);

    render(<QecWorkbenchTray connectClient={connectClient} />);
    await waitFor(() => expect(connectClient).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(connectedClient.subscribeDisconnect).toHaveBeenCalledOnce());
    act(() => disconnectListener?.(new QecDataClientError('engine_disconnected', 'QEC Data Engine disconnected.')));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/QEC Data Engine disconnected/);
    expect(screen.queryByText('No active jobs')).toBeNull();
    const retry = within(alert).getByRole('button', { name: 'Retry QEC Data Engine' });
    fireEvent.click(retry);
    await waitFor(() => expect(connectClient).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(replacementClient.subscribeDisconnect).toHaveBeenCalledOnce());
    expect(connectClient).toHaveBeenNthCalledWith(2, '/project');
  });

  it('loads engine sessions for the project and refreshes after import completion', async () => {
    useProjectStore.setState({ projectRoot: '/project' });
    const listSessions = vi.fn(async () => []);
    const client = { ...importClient(), listSessions };

    render(<QecWorkbenchTray client={client} />);
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));

    act(() => useQecJobStore.setState({
      jobs: {
        complete: {
          id: 'complete', kind: 'import', status: 'complete', message: 'Import complete',
          sessionId: 'minimal-capture', source: 'captures/minimal.dets',
        },
      },
    }));

    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
  });

  it('hydrates scoped context and debounces an immutable platform-store snapshot', async () => {
    useProjectStore.setState({ projectRoot: '/project' });
    const writes: Array<{ key: string; value: unknown }> = [];
    const bridge = persistenceBridge(
      vi.fn(async () => persistedState('analyze')),
      vi.fn(async (key, value) => { writes.push({ key, value }); }),
    );

    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    await waitFor(() => expect(useQecWorkbenchStore.getState().preset).toBe('analyze'));
    expect(useResearchSelectionStore.getState().present).toMatchObject({
      primary: { kind: 'detector', id: 'D42' },
      source: 'restore',
    });
    expect(useQecWorkbenchStore.getState().trayCollapsed).toBe(true);

    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      key: `qec-workbench:/project:${STUDY.id}`,
      value: { schema: 1, preset: 'observe', trayCollapsed: true },
    });
  });

  it('ignores a stale load when the active Study switches', async () => {
    setStudies();
    useProjectStore.setState({ projectRoot: '/project' });
    let resolveFirst: ((value: unknown) => void) | null = null;
    const first = new Promise<unknown>((resolve) => { resolveFirst = resolve; });
    const bridge = persistenceBridge(vi.fn(async (key: string) =>
      key.endsWith(STUDY.id) ? first : persistedState('observe')));
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    act(() => useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id));
    await waitFor(() => expect(useQecWorkbenchStore.getState().preset).toBe('observe'));
    await act(async () => { resolveFirst?.(persistedState('analyze')); await first; });

    expect(useQecWorkbenchStore.getState().preset).toBe('observe');
  });

  it.each([
    [SECOND_STUDY, 'analyze'],
    [{ ...SECOND_STUDY, id: 'observe-study', preset: 'observe' as const }, 'observe'],
  ] as const)('uses a newly selected Study manifest preset when no stored scope exists', async (study, preset) => {
    setStudies([STUDY, study]);
    useProjectStore.setState({ projectRoot: '/project' });
    const bridge = persistenceBridge(vi.fn(async () => null));
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await waitFor(() => expect(useQecWorkbenchStore.getState().preset).toBe('build'));

    act(() => useQecStudyUiStore.getState().setActiveStudy(study.id));

    await waitFor(() => expect(useQecWorkbenchStore.getState().preset).toBe(preset));
  });

  it('lets a valid stored preset override the selected Study manifest preset', async () => {
    setStudies([STUDY, SECOND_STUDY]);
    useProjectStore.setState({ projectRoot: '/project' });
    const bridge = persistenceBridge(vi.fn(async (key: string) =>
      key.endsWith(SECOND_STUDY.id) ? persistedState('observe') : null));
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    act(() => useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id));

    await waitFor(() => expect(useQecWorkbenchStore.getState().preset).toBe('observe'));
  });

  it('merges a pending read without overwriting same-scope local edits', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const read = deferred<unknown>();
    const writes: unknown[] = [];
    const bridge = persistenceBridge(
      vi.fn(async () => read.promise),
      vi.fn(async (_key, value) => { writes.push(value); }),
    );
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    act(() => {
      useQecWorkbenchStore.getState().setPreset('observe');
      useResearchSelectionStore.getState().selectPrimary(
        { kind: 'finding', id: 'local-finding' },
        'user',
      );
    });
    read.resolve(persistedState('analyze'));
    await flushAsync();

    expect(useQecWorkbenchStore.getState()).toMatchObject({
      preset: 'observe',
      inspectorWidth: 410,
    });
    expect(useResearchSelectionStore.getState().present.primary).toMatchObject({
      kind: 'finding', id: 'local-finding',
    });
    await flushPersistenceDebounce();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      preset: 'observe',
      selection: { primary: { kind: 'finding', id: 'local-finding' } },
    });
  });

  it('serializes in-flight saves and coalesces two later changes to the newest snapshot', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const values: unknown[] = [];
    const setStoredValue = vi.fn(async (_key: string, value: unknown) => {
      values.push(value);
      return values.length === 1 ? firstWrite.promise : secondWrite.promise;
    });
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    act(() => {
      useQecWorkbenchStore.getState().setPreset('observe');
      useQecWorkbenchStore.getState().setTrayCollapsed(false);
    });
    await flushPersistenceDebounce();
    expect(setStoredValue).toHaveBeenCalledTimes(1);

    firstWrite.resolve();
    await flushAsync();
    expect(setStoredValue).toHaveBeenCalledTimes(2);
    expect(values[1]).toMatchObject({ preset: 'observe', trayCollapsed: false });
    secondWrite.resolve();
    await flushAsync();
  });

  it('keeps a newer write failure status when an older retry completes late', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const firstWrite = deferred<void>();
    const retryWrite = deferred<void>();
    const newestWrite = deferred<void>();
    const attempts = [firstWrite, retryWrite, newestWrite];
    const setStoredValue = vi.fn(async () => attempts[setStoredValue.mock.calls.length - 1].promise);
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    firstWrite.reject(new Error('first failure'));
    await flushAsync();
    const retry = screen.getByRole<HTMLButtonElement>('button', { name: 'Retry save' });
    fireEvent.click(retry, { detail: 0 });
    expect(retry.disabled).toBe(true);

    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    await flushPersistenceDebounce();
    retryWrite.resolve();
    await flushAsync();
    expect(screen.getByRole('alert').textContent).toMatch(/save QEC workspace context/i);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Retry save' }).disabled).toBe(true);

    newestWrite.reject(new Error('newest failure'));
    await flushAsync();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Retry save' }).disabled).toBe(false);
  });

  it('ignores a late in-flight save failure after switching persistence scope', async () => {
    vi.useFakeTimers();
    setStudies();
    useProjectStore.setState({ projectRoot: '/project' });
    const oldWrite = deferred<void>();
    const setStoredValue = vi.fn(async () => oldWrite.promise);
    const bridge = persistenceBridge(vi.fn(async (key: string) =>
      key.endsWith(SECOND_STUDY.id) ? persistedState('observe') : persistedState('build')),
    setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    expect(setStoredValue).toHaveBeenCalledTimes(1);
    act(() => useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id));
    await flushAsync();
    expect(useQecWorkbenchStore.getState().preset).toBe('observe');

    oldWrite.reject(new Error('late old-scope failure'));
    await flushAsync();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useQecWorkbenchStore.getState().preset).toBe('observe');
  });

  it('keeps the replacement ABA write last after a disposed session reserves a retry', async () => {
    vi.useFakeTimers();
    setStudies();
    useProjectStore.setState({ projectRoot: '/project' });
    const oldAWrite = deferred<void>();
    const invocations: Array<{ key: string; value: unknown }> = [];
    const durable = new Map<string, unknown>();
    const setStoredValue = vi.fn(async (key: string, value: unknown) => {
      invocations.push({ key, value });
      if (invocations.length === 1) await oldAWrite.promise;
      durable.set(key, value);
    });
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    act(() => useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id));
    await flushAsync();
    act(() => useQecStudyUiStore.getState().setActiveStudy(STUDY.id));
    await flushAsync();
    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    await flushPersistenceDebounce();

    expect(setStoredValue).toHaveBeenCalledTimes(1);
    oldAWrite.resolve();
    await flushAsync();
    expect(setStoredValue).toHaveBeenCalledTimes(3);
    expect(invocations[1]).toMatchObject({
      key: `qec-workbench:/project:${STUDY.id}`,
      value: { preset: 'analyze' },
    });
    expect(invocations.at(-1)).toMatchObject({
      key: `qec-workbench:/project:${STUDY.id}`,
      value: { preset: 'observe' },
    });
    expect(durable.get(`qec-workbench:/project:${STUDY.id}`)).toMatchObject({ preset: 'observe' });
  });

  it('reserves pending-read disposal order before a replacement ABA write', async () => {
    vi.useFakeTimers();
    setStudies();
    useProjectStore.setState({ projectRoot: '/project' });
    const oldRead = deferred<unknown>();
    let firstARead = true;
    const durable = new Map<string, unknown>();
    const getStoredValue = vi.fn(async (key: string) => {
      if (key.endsWith(STUDY.id) && firstARead) {
        firstARead = false;
        return oldRead.promise;
      }
      return persistedState('build');
    });
    const setStoredValue = vi.fn(async (key: string, value: unknown) => {
      durable.set(key, value);
    });
    const bridge = persistenceBridge(getStoredValue, setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    act(() => {
      useQecWorkbenchStore.getState().setPreset('observe');
      useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id);
    });
    await flushAsync();
    act(() => useQecStudyUiStore.getState().setActiveStudy(STUDY.id));
    await flushAsync();
    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    expect(setStoredValue).not.toHaveBeenCalledWith(
      `qec-workbench:/project:${STUDY.id}`,
      expect.anything(),
    );

    oldRead.resolve(persistedState('build'));
    await flushAsync();
    await flushAsync();

    expect(durable.get(`qec-workbench:/project:${STUDY.id}`)).toMatchObject({ preset: 'analyze' });
  });

  it('keeps different persistence keys independent while one key is blocked', async () => {
    vi.useFakeTimers();
    setStudies();
    useProjectStore.setState({ projectRoot: '/project' });
    const oldAWrite = deferred<void>();
    const invocations: Array<{ key: string; value: unknown }> = [];
    const setStoredValue = vi.fn(async (key: string, value: unknown) => {
      invocations.push({ key, value });
      if (key.endsWith(STUDY.id)) await oldAWrite.promise;
    });
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    act(() => useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id));
    await flushAsync();
    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    await flushPersistenceDebounce();

    expect(setStoredValue).toHaveBeenCalledTimes(2);
    expect(invocations[1].key).toBe(`qec-workbench:/project:${SECOND_STUDY.id}`);
    oldAWrite.resolve();
    await flushAsync();
  });

  it('removes the disposed scope retry action when the active Study is cleared', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const bridge = persistenceBridge(vi.fn(async () => { throw new Error('read failed'); }));
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();
    expect(screen.getByRole('button', { name: 'Retry restore' })).toBeTruthy();

    act(() => useQecStudyUiStore.getState().clearActiveStudy());

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries a failed restore from an accessible keyboard-operated action', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const retryRead = deferred<unknown>();
    const getStoredValue = vi.fn()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockImplementationOnce(async () => retryRead.promise);
    const bridge = persistenceBridge(getStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Retry restore to recover/i);
    const retry = within(alert).getByRole<HTMLButtonElement>('button', { name: 'Retry restore' });
    retry.focus();
    fireEvent.click(retry, { detail: 0 });
    expect(document.activeElement).toBe(retry);
    expect(retry.disabled).toBe(true);

    retryRead.resolve(persistedState('analyze'));
    await flushAsync();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useQecWorkbenchStore.getState().preset).toBe('analyze');
  });

  it('retries a failed save and clears its matching status after success', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const retryWrite = deferred<void>();
    const setStoredValue = vi.fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockImplementationOnce(async () => retryWrite.promise);
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();
    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    await flushAsync();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Retry save to preserve/i);
    const retry = within(alert).getByRole<HTMLButtonElement>('button', { name: 'Retry save' });
    retry.focus();
    fireEvent.click(retry, { detail: 0 });
    expect(document.activeElement).toBe(retry);
    expect(retry.disabled).toBe(true);

    retryWrite.resolve();
    await flushAsync();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports platform read and write failures in the workbench shell', async () => {
    useProjectStore.setState({ projectRoot: '/project' });
    const readFailure = persistenceBridge(vi.fn(async () => { throw new Error('read failed'); }));
    const firstRender = render(
      <PlatformProvider bridge={readFailure}><QecWorkbench /></PlatformProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/restore QEC workspace context/i);
    firstRender.unmount();

    const writeFailure = persistenceBridge(
      vi.fn(async () => persistedState('build')),
      vi.fn(async () => { throw new Error('write failed'); }),
    );
    render(<PlatformProvider bridge={writeFailure}><QecWorkbench /></PlatformProvider>);
    await waitFor(() => expect(useQecWorkbenchStore.getState().persistenceError).toBeNull());
    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/save QEC workspace context/i);
  });

  it('flushes pending persistence when the shell unmounts', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const setStoredValue = vi.fn(async () => undefined);
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    const view = render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();
    expect(useQecWorkbenchStore.getState().trayCollapsed).toBe(true);

    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    view.unmount();
    await flushAsync();

    expect(setStoredValue).toHaveBeenCalledWith(
      `qec-workbench:/project:${STUDY.id}`,
      expect.objectContaining({ preset: 'analyze' }),
    );
  });

  it('merges untouched stored fields before a pending-read disposal flush', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const read = deferred<unknown>();
    const setStoredValue = vi.fn(async () => undefined);
    const bridge = persistenceBridge(vi.fn(async () => read.promise), setStoredValue);
    const view = render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    view.unmount();
    read.resolve(persistedState('analyze'));
    await flushAsync();

    expect(setStoredValue).toHaveBeenCalledWith(
      `qec-workbench:/project:${STUDY.id}`,
      expect.objectContaining({ preset: 'observe', inspectorWidth: 410, trayCollapsed: true }),
    );
  });

  it('flushes local edits when a pending restore rejects after disposal', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const read = deferred<unknown>();
    const setStoredValue = vi.fn(async () => undefined);
    const bridge = persistenceBridge(vi.fn(async () => read.promise), setStoredValue);
    const view = render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    view.unmount();
    read.reject(new Error('restore unavailable'));
    await flushAsync();

    expect(setStoredValue).toHaveBeenCalledWith(
      `qec-workbench:/project:${STUDY.id}`,
      expect.objectContaining({ preset: 'observe' }),
    );
  });

  it('logs a scoped disposal-flush failure without publishing stale UI state', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bridge = persistenceBridge(
      vi.fn(async () => persistedState('build')),
      vi.fn(async () => { throw new Error('store offline'); }),
    );
    const view = render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();
    act(() => useQecWorkbenchStore.getState().setPreset('observe'));

    view.unmount();
    await flushAsync();

    expect(consoleError).toHaveBeenCalledWith(
      'QEC workspace disposal flush failed.',
      expect.objectContaining({
        scopeKey: `qec-workbench:/project:${STUDY.id}`,
        error: expect.any(Error),
      }),
    );
    expect(useQecWorkbenchStore.getState().persistenceIssue).toBeNull();
    consoleError.mockRestore();
  });

  it('queues the latest snapshot behind an in-flight write when disposing', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const firstWrite = deferred<void>();
    const setStoredValue = vi.fn(async () => {
      if (setStoredValue.mock.calls.length === 1) await firstWrite.promise;
    });
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    const view = render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();
    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    await flushPersistenceDebounce();
    expect(setStoredValue).toHaveBeenCalledTimes(1);

    view.unmount();
    firstWrite.reject(new Error('first write failed'));
    await flushAsync();
    await flushAsync();

    expect(setStoredValue).toHaveBeenCalledTimes(2);
    expect(setStoredValue.mock.calls[1]).toEqual([
      `qec-workbench:/project:${STUDY.id}`,
      expect.objectContaining({ preset: 'observe' }),
    ]);
    expect(useQecWorkbenchStore.getState().persistenceIssue).toBeNull();
  });

  it('flushes the old Study snapshot when scope switches before the debounce', async () => {
    vi.useFakeTimers();
    setStudies();
    useProjectStore.setState({ projectRoot: '/project' });
    const writes: Array<{ key: string; value: unknown }> = [];
    const bridge = persistenceBridge(
      vi.fn(async () => null),
      vi.fn(async (key, value) => { writes.push({ key, value }); }),
    );
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    act(() => {
      useQecWorkbenchStore.getState().setPreset('observe');
      useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id);
    });
    await flushAsync();

    expect(writes).toContainEqual({
      key: `qec-workbench:/project:${STUDY.id}`,
      value: expect.objectContaining({ preset: 'observe' }),
    });
  });

  it('renders a distinct Study loading state', () => {
    useQecStudyUiStore.setState({ activeStudyId: null });
    useQecStudyStore.setState({ studies: [], validationErrors: [], loading: true });
    render(<QecWorkbench />);
    expect(screen.getByRole('status', { name: 'Loading QEC Studies' })).toBeTruthy();
    expect(screen.getByText('Parsing and validating Study manifests.')).toBeTruthy();
    expect(screen.queryByText(/referenced sources/i)).toBeNull();
  });

  it('renders malformed Study file names and actionable validation details', () => {
    useQecStudyUiStore.setState({ activeStudyId: null });
    useQecStudyStore.setState({
      studies: [],
      loading: false,
      validationErrors: [{
        fileName: 'broken.qec-study.yaml',
        errors: ['question: Required', 'sources.0.path: path must stay inside the project'],
      }],
    });
    render(<QecWorkbench />);
    expect(screen.getByRole('alert', { name: 'Study validation issues' })).toBeTruthy();
    expect(screen.getByText('broken.qec-study.yaml')).toBeTruthy();
    expect(screen.getByText('question: Required')).toBeTruthy();
    expect(screen.getByText(/path must stay inside the project/)).toBeTruthy();
    expect(screen.getByText(/Fix these fields and save/)).toBeTruthy();
    expect(screen.getByText('2 validation issues')).toBeTruthy();
  });

  it('renders a safe empty state when no Studies exist', () => {
    useQecStudyUiStore.setState({ activeStudyId: null });
    useQecStudyStore.setState({ studies: [], validationErrors: [], loading: false });
    render(<QecWorkbench />);
    expect(screen.getByText('No Studies found')).toBeTruthy();
    expect(screen.getByText(/Create a Study manifest/)).toBeTruthy();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Active QEC Study' }).disabled).toBe(true);
    expect(screen.getByText('Not evaluated')).toBeTruthy();
    expect(screen.getAllByText('Provenance not evaluated')).toHaveLength(2);
  });

  it('distinguishes manifest validity from provenance evaluation', () => {
    render(<QecWorkbench />);
    expect(screen.getByText('Manifest valid')).toBeTruthy();
    expect(screen.getAllByText('Provenance not evaluated')).toHaveLength(2);
    expect(screen.queryByText('Validated')).toBeNull();
    expect(screen.queryByText('Provenance ready')).toBeNull();
  });

});
