import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { PlatformBridge } from '../../../platform/bridge';

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
