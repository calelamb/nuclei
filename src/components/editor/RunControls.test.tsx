// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RunControls, RUN_SLOT_MIN_WIDTH } from './RunControls';
import { useEditorStore } from '../../stores/editorStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useRunQueueStore } from '../../stores/runQueueStore';
import { PlatformProvider } from '../../platform/PlatformProvider';
import type { PlatformBridge } from '../../platform/bridge';

const execute = vi.fn();
vi.mock('../../App', () => ({ getExecute: () => execute }));

const bridge = { getPlatform: () => 'web' } as unknown as PlatformBridge;
const mount = () => render(<PlatformProvider bridge={bridge}><RunControls density="full" /></PlatformProvider>);

beforeEach(() => {
  execute.mockClear();
  useSimulationStore.setState({ isRunning: false });
  useRunQueueStore.setState({ queued: false });
  useEditorStore.setState({
    kernelReady: false, kernelStatus: 'connecting', kernelError: null,
    kernelProgress: { step: 1, total: 3, label: 'Loading Python', fraction: 0.2 },
  });
});
afterEach(cleanup);

describe('Run slot while Python boots (web)', () => {
  it('is clickable: the press asks for a run, which queues', () => {
    mount();
    const btn = screen.getByRole('button', { name: /Starting 1\/3/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('Starting 1/3');
    fireEvent.click(btn);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('shows Queued once a run is waiting, and a second click cancels it', () => {
    useRunQueueStore.setState({ queued: true });
    mount();
    const btn = screen.getByRole('button', { name: /Queued · 1\/3/ });
    expect(btn.textContent).toContain('Queued · 1/3');
    fireEvent.click(btn);
    expect(execute).not.toHaveBeenCalled();
    expect(useRunQueueStore.getState().queued).toBe(false);
  });

  it('is named by its visible label and exposes the queued toggle state (interaction-r-06)', () => {
    const { unmount } = mount();
    const waiting = screen.getByRole('button', { name: /Starting 1\/3/ });
    expect(waiting.getAttribute('aria-label')).toBeNull();
    expect(waiting.getAttribute('aria-pressed')).toBe('false');
    unmount();
    useRunQueueStore.setState({ queued: true });
    mount();
    expect(screen.getByRole('button', { name: /Queued · 1\/3/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a failed kernel stays a disabled status', () => {
    useEditorStore.setState({ kernelStatus: 'failed', kernelError: 'boom', kernelProgress: null });
    mount();
    expect((screen.getByRole('button', { name: /Python didn't start/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Run slot width (shell-r6-05)', () => {
  it('holds one minimum width from the boot label to Run, so it does not resize as Python boots', () => {
    const { rerender } = mount();
    const booting = screen.getByRole('button', { name: /Starting 1\/3/ }) as HTMLButtonElement;
    expect(booting.style.minWidth).toBe(`${RUN_SLOT_MIN_WIDTH}px`);
    useEditorStore.setState({ kernelReady: true, kernelStatus: 'ready', kernelProgress: null });
    rerender(<PlatformProvider bridge={bridge}><RunControls density="full" /></PlatformProvider>);
    expect((screen.getByRole('button', { name: /Run/ }) as HTMLButtonElement).style.minWidth).toBe(`${RUN_SLOT_MIN_WIDTH}px`);
  });
});
