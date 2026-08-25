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
import { useResearchSelectionStore } from '../../../stores/researchSelectionStore';
import { QecWorkbench } from './QecWorkbench';
import { QecSourcesPanel } from './QecSourcesPanel';
import { QecWorkbenchTray } from './QecWorkbenchTray';
import {
  QEC_DATA_AUTHENTICATION_TIMEOUT_MS,
  QecDataClientError,
  type QecImportClient,
} from '../../../services/qecDataClient';
import type { PlatformBridge } from '../../../platform/bridge';
import type { QecSession } from '../../../types/qecData';
import {
  deferred,
  flushAsync,
  flushPersistenceDebounce,
  persistenceBridge,
  resetQecWorkbenchTestState,
  SECOND_STUDY,
  setStudies,
  STUDY,
  STUDY_UI_ACTIONS,
} from './qecWorkbenchTestUtils';

function importClient(): QecImportClient {
  return {
    probe: vi.fn(async () => ({ type: 'import_probe_result', requestId: 'p', sourcePolicy: 'copy', sourceByteSize: 1, results: [] })),
    validate: vi.fn(), preview: vi.fn(), startImport: vi.fn(), cancel: vi.fn(async () => true),
  };
}

class AutoAuthSocket {
  readonly listeners = new Map<string, Array<(event: Event | MessageEvent<string>) => void>>();

  constructor() {
    queueMicrotask(() => this.emit('open', new Event('open')));
  }

  addEventListener(type: string, listener: (event: Event | MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(frame: string): void {
    const message = JSON.parse(frame) as { type?: string };
    if (message.type === 'authenticate') {
      queueMicrotask(() => this.emit('message', new MessageEvent('message', {
        data: JSON.stringify({ type: 'authenticated' }),
      })));
    }
  }

  close(): void {
    this.emit('close', new Event('close'));
  }

  private emit(type: string, event: Event | MessageEvent<string>): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class LifecycleSocket {
  static readonly events: string[] = [];
  static nextId = 0;

  readonly id = LifecycleSocket.nextId++;
  readonly listeners = new Map<string, Array<(event: Event | MessageEvent<string>) => void>>();

  constructor() {
    queueMicrotask(() => this.emit('open', new Event('open')));
  }

  static reset(): void {
    LifecycleSocket.events.splice(0);
    LifecycleSocket.nextId = 0;
  }

  addEventListener(type: string, listener: (event: Event | MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(frame: string): void {
    const message = JSON.parse(frame) as {
      type: string;
      requestId?: string;
      jobId?: string;
      queryRequestId?: string;
    };
    LifecycleSocket.events.push(`socket:${this.id}:${message.type}`);
    if (message.type === 'authenticate') {
      queueMicrotask(() => this.message({ type: 'authenticated' }));
    } else if (message.type === 'job_cancel') {
      queueMicrotask(() => this.message({
        type: 'job_cancelled', requestId: message.requestId,
        jobId: message.jobId, success: true,
      }));
    } else if (message.type === 'query_cancel') {
      queueMicrotask(() => this.message({
        type: 'query_cancelled', requestId: message.requestId,
        queryRequestId: message.queryRequestId, success: true,
      }));
    }
  }

  close(): void {
    LifecycleSocket.events.push(`socket:${this.id}:close`);
  }

  private message(value: unknown): void {
    this.emit('message', new MessageEvent('message', { data: JSON.stringify(value) }));
  }

  private emit(type: string, event: Event | MessageEvent<string>): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class NeverAuthSocket {
  readonly listeners = new Map<string, Array<(event: Event | MessageEvent<string>) => void>>();

  constructor() {
    queueMicrotask(() => this.emit('open', new Event('open')));
  }

  addEventListener(type: string, listener: (event: Event | MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(): void {}
  close(): void {}

  private emit(type: string, event: Event | MessageEvent<string>): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function qecLifecycleBridge(overrides: Partial<PlatformBridge> = {}): PlatformBridge {
  return {
    ...persistenceBridge(vi.fn(async () => null)),
    startQecDataEngine: vi.fn(async () => ({
      url: 'ws://127.0.0.1:9743', token: 'test-token',
    })),
    stopQecDataEngine: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  resetQecWorkbenchTestState();
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
    const bridge = qecLifecycleBridge({
      startQecDataEngine: vi.fn(() => new Promise(() => undefined)),
    });
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

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

  it('retires the native engine before starting a replacement project without overlapping starts', async () => {
    vi.stubGlobal('WebSocket', AutoAuthSocket);
    useProjectStore.setState({ projectRoot: '/old-project' });
    const stopGate = deferred<void>();
    const lifecycle: string[] = [];
    const startQecDataEngine = vi.fn(async (projectRoot: string) => {
      lifecycle.push(`start:${projectRoot}`);
      return { url: 'ws://127.0.0.1:9743', token: 'test-token' };
    });
    const stopQecDataEngine = vi.fn(async () => {
      lifecycle.push('stop');
      await stopGate.promise;
    });
    const bridge = qecLifecycleBridge({ startQecDataEngine, stopQecDataEngine });

    render(<PlatformProvider bridge={bridge}><QecWorkbenchTray /></PlatformProvider>);
    await waitFor(() => expect(startQecDataEngine).toHaveBeenCalledWith('/old-project'));
    await waitFor(() => expect(screen.getByText('No active jobs')).toBeTruthy());

    act(() => useProjectStore.setState({ projectRoot: '/new-project' }));
    await waitFor(() => expect(stopQecDataEngine).toHaveBeenCalledTimes(1));
    expect(startQecDataEngine).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['start:/old-project', 'stop']);

    stopGate.resolve();
    await waitFor(() => expect(startQecDataEngine).toHaveBeenCalledWith('/new-project'));
    expect(lifecycle).toEqual(['start:/old-project', 'stop', 'start:/new-project']);
  });

  it('captures old project cancellation ids before scope reset and retires them in order', async () => {
    LifecycleSocket.reset();
    vi.stubGlobal('WebSocket', LifecycleSocket);
    useProjectStore.setState({ projectRoot: '/old-project' });
    const lifecycle = LifecycleSocket.events;
    const bridge = qecLifecycleBridge({
      startQecDataEngine: vi.fn(async (root: string) => {
        lifecycle.push(`native:start:${root}`);
        return { url: 'ws://127.0.0.1:9743', token: 'test-token' };
      }),
      stopQecDataEngine: vi.fn(async () => { lifecycle.push('native:stop'); }),
    });

    render(<PlatformProvider bridge={bridge}><QecWorkbenchTray /></PlatformProvider>);
    await waitFor(() => expect(lifecycle).toContain('socket:0:authenticate'));
    act(() => {
      useQecJobStore.setState({
        jobs: {
          'old-import': {
            id: 'old-import', kind: 'import', status: 'running', message: 'Running',
            projectRoot: '/old-project',
          },
        },
      });
      useQecQueryStore.setState({
        tiles: {
          old: {
            projectRoot: '/old-project', requestId: 'old-query', epoch: 1,
            status: 'loading', progress: 0, message: 'Running', frames: [], error: null,
          },
        },
      });
      useProjectStore.setState({ projectRoot: '/new-project' });
    });

    await waitFor(() => expect(lifecycle).toContain('native:start:/new-project'));
    const importCancel = lifecycle.indexOf('socket:0:job_cancel');
    const queryCancel = lifecycle.indexOf('socket:0:query_cancel');
    const disconnect = lifecycle.indexOf('socket:0:close');
    const stop = lifecycle.indexOf('native:stop');
    const replacement = lifecycle.indexOf('native:start:/new-project');
    expect(importCancel).toBeGreaterThan(-1);
    expect(queryCancel).toBeGreaterThan(-1);
    expect(Math.max(importCancel, queryCancel)).toBeLessThan(disconnect);
    expect(disconnect).toBeLessThan(stop);
    expect(stop).toBeLessThan(replacement);
  });

  it('stops a silent authenticating engine before starting the replacement project', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', NeverAuthSocket);
    useProjectStore.setState({ projectRoot: '/old-project' });
    const lifecycle: string[] = [];
    const bridge = qecLifecycleBridge({
      startQecDataEngine: vi.fn(async (root: string) => {
        lifecycle.push(`start:${root}`);
        return { url: 'ws://127.0.0.1:9743', token: 'test-token' };
      }),
      stopQecDataEngine: vi.fn(async () => { lifecycle.push('stop'); }),
    });

    render(<PlatformProvider bridge={bridge}><QecWorkbenchTray /></PlatformProvider>);
    await flushAsync();
    expect(lifecycle).toEqual(['start:/old-project']);
    act(() => useProjectStore.setState({ projectRoot: '/new-project' }));
    await flushAsync();
    expect(lifecycle).toEqual(['start:/old-project']);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(QEC_DATA_AUTHENTICATION_TIMEOUT_MS);
    });
    await flushAsync();

    expect(lifecycle).toEqual(['start:/old-project', 'stop', 'start:/new-project']);
    vi.useRealTimers();
  });

  it('keeps initial and repeated retry failures visible while reconnects stay single-flight', async () => {
    useProjectStore.setState({ projectRoot: '/project' });
    const secondStart = deferred<unknown>();
    const startQecDataEngine = vi.fn()
      .mockRejectedValueOnce(new Error('Python dependency missing.'))
      .mockImplementationOnce(() => secondStart.promise)
      .mockRejectedValueOnce(new Error('Port remains unavailable.'));
    const stopQecDataEngine = vi.fn(async () => undefined);
    const bridge = qecLifecycleBridge({ startQecDataEngine, stopQecDataEngine });

    render(<PlatformProvider bridge={bridge}><QecWorkbenchTray /></PlatformProvider>);
    expect(screen.getByRole('status').textContent).toMatch(/Starting authenticated QEC Data Engine/);
    const firstAlert = await screen.findByRole('alert');
    expect(firstAlert.textContent).toMatch(/Python dependency missing/);

    fireEvent.click(within(firstAlert).getByRole('button', { name: 'Retry QEC Data Engine' }));
    await waitFor(() => expect(startQecDataEngine).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status').textContent).toMatch(/Starting authenticated QEC Data Engine/);
    expect(stopQecDataEngine).toHaveBeenCalledTimes(1);
    expect(startQecDataEngine).toHaveBeenNthCalledWith(2, '/project');

    secondStart.reject(new Error('Authentication failed.'));
    const secondAlert = await screen.findByRole('alert');
    expect(secondAlert.textContent).toMatch(/Authentication failed/);
    fireEvent.click(within(secondAlert).getByRole('button', { name: 'Retry QEC Data Engine' }));
    await waitFor(() => expect(startQecDataEngine).toHaveBeenCalledTimes(3));
    const thirdAlert = await screen.findByRole('alert');
    expect(thirdAlert.textContent).toMatch(/Port remains unavailable/);
    expect(stopQecDataEngine).toHaveBeenCalledTimes(2);
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
