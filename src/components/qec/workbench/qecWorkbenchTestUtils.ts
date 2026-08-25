import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { PlatformBridge } from '../../../platform/bridge';
import { useQecStudyStore } from '../../../services/qecStudyStore';
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

export const STUDY = {
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

export const SECOND_STUDY = {
  ...STUDY,
  id: 'decoder-study',
  name: 'Decoder Study',
  question: 'Which decoder has the best tail latency?',
  preset: 'analyze' as const,
  sources: [],
};

export const STUDY_UI_ACTIONS = {
  clearActiveStudy: useQecStudyUiStore.getState().clearActiveStudy,
  setActiveStudy: useQecStudyUiStore.getState().setActiveStudy,
};

export function setStudies(studies = [STUDY, SECOND_STUDY]): void {
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

export function resetQecWorkbenchTestState(): void {
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
}

export class MemoryStorage implements Storage {
  private values: Readonly<Record<string, string>> = {};

  get length(): number { return Object.keys(this.values).length; }
  clear(): void { this.values = {}; }
  getItem(key: string): string | null { return this.values[key] ?? null; }
  key(index: number): string | null { return Object.keys(this.values)[index] ?? null; }
  removeItem(key: string): void {
    this.values = Object.fromEntries(
      Object.entries(this.values).filter(([storedKey]) => storedKey !== key),
    );
  }
  setItem(key: string, value: string): void { this.values = { ...this.values, [key]: value }; }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

export async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export async function flushPersistenceDebounce(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}

export function persistenceBridge(
  getStoredValue: PlatformBridge['getStoredValue'],
  setStoredValue: PlatformBridge['setStoredValue'] = vi.fn(async () => undefined),
): PlatformBridge {
  return {
    startKernel: vi.fn(), stopKernel: vi.fn(), openFile: vi.fn(), readFile: vi.fn(),
    saveFile: vi.fn(), saveFileAs: vi.fn(), renameFile: vi.fn(), setWindowTitle: vi.fn(),
    getPlatform: () => 'desktop', openDirectory: vi.fn(), listDirectory: vi.fn(),
    createFile: vi.fn(), createDirectory: vi.fn(), deleteFile: vi.fn(),
    getStoredValue,
    setStoredValue,
  };
}

export function persistedState(preset: 'build' | 'analyze' | 'observe') {
  return {
    schema: 1,
    preset,
    pinnedPanelIds: ['timeline'],
    sourceWidth: 310,
    inspectorWidth: 410,
    trayHeight: 290,
    trayCollapsed: true,
    selection: {
      primary: { kind: 'detector' as const, id: 'D42' },
      scope: [],
      timeWindow: { start: 1, end: 5, domain: 'round' as const },
      source: 'panel' as const,
    },
  };
}
