// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformProvider } from '../../../platform/PlatformProvider';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { useResearchSelectionStore } from '../../../stores/researchSelectionStore';
import { QecWorkbench } from './QecWorkbench';
import {
  deferred,
  flushAsync,
  flushPersistenceDebounce,
  persistedState,
  persistenceBridge,
  resetQecWorkbenchTestState,
  SECOND_STUDY,
  setStudies,
  STUDY,
} from './qecWorkbenchTestUtils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  resetQecWorkbenchTestState();
});

describe('<QecWorkbench /> persistence', () => {
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
});
