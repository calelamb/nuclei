// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformBridge } from './bridge';
import { loadBridge, PlatformProvider, usePlatform } from './PlatformProvider';

function Probe({ onBridge }: { onBridge: (bridge: PlatformBridge) => void }) {
  onBridge(usePlatform());
  return null;
}

function explicitBridge(): PlatformBridge {
  return {
    startKernel: vi.fn(async () => 'ready'), stopKernel: vi.fn(async () => 'stopped'),
    openFile: vi.fn(async () => null), readFile: vi.fn(async () => null),
    saveFile: vi.fn(async () => undefined), saveFileAs: vi.fn(async () => null),
    renameFile: vi.fn(async () => null), getStoredValue: vi.fn(async () => null),
    setStoredValue: vi.fn(async () => undefined), setWindowTitle: vi.fn(async () => undefined),
    getPlatform: () => 'web', openDirectory: vi.fn(async () => null),
    listDirectory: vi.fn(async () => null), createFile: vi.fn(async () => null),
    createDirectory: vi.fn(async () => null), deleteFile: vi.fn(async () => false),
  };
}

afterEach(() => cleanup());

describe('PlatformProvider', () => {
  it('exposes an injected bridge unchanged', () => {
    const expected = explicitBridge();
    let observed: PlatformBridge | null = null;
    render(<PlatformProvider bridge={expected}><Probe onBridge={(value) => { observed = value; }} /></PlatformProvider>);
    expect(observed).toBe(expected);
  });

  it('fails safely before the asynchronous platform bridge is ready', async () => {
    let fallback: PlatformBridge | null = null;
    render(<Probe onBridge={(value) => { fallback = value; }} />);
    expect(fallback).not.toBeNull();
    const bridge = fallback as unknown as PlatformBridge;
    expect(await bridge.startKernel()).toBe('Kernel unavailable');
    expect(await bridge.stopKernel()).toBe('Kernel unavailable');
    expect(await bridge.openFile()).toBeNull();
    expect(await bridge.readFile('missing')).toBeNull();
    await expect(bridge.saveFile('missing', '')).resolves.toBeUndefined();
    expect(await bridge.saveFileAs('')).toBeNull();
    expect(await bridge.renameFile('old', 'new')).toBeNull();
    expect(await bridge.getStoredValue('missing')).toBeNull();
    await expect(bridge.setStoredValue('key', 'value')).resolves.toBeUndefined();
    await expect(bridge.setWindowTitle('Nuclei')).resolves.toBeUndefined();
    expect(bridge.getPlatform()).toBe('web');
    expect(await bridge.openDirectory()).toBeNull();
    expect(await bridge.listDirectory('missing')).toBeNull();
    expect(await bridge.createFile('missing', '')).toBeNull();
    expect(await bridge.createDirectory('missing')).toBeNull();
    expect(await bridge.deleteFile('missing')).toBe(false);
  });

  it('loads and caches the browser bridge when Tauri is absent', async () => {
    const first = await loadBridge();
    const second = await loadBridge();
    expect(first.getPlatform()).toBe('web');
    expect(second).toBe(first);
  });
});
