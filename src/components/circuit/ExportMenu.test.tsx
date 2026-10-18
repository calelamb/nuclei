// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useCircuitStore } from '../../stores/circuitStore';
import { ExportMenu, COPIED_NOTICE_MS } from './ExportMenu';
import { TOOLTIP_OPEN_DELAY_MS } from '../ui/Tooltip';
import { exportDisabledReason } from './exportDisabledReason';

const copyCode = vi.fn();
vi.mock('../../hooks/useCircuitExport', () => ({
  useCircuitExport: () => ({
    exportQasmFile: vi.fn(), exportSvg: vi.fn(async () => true), exportPng: vi.fn(async () => true),
    copyCodeToClipboard: copyCode, copyQasmToClipboard: vi.fn(async () => {}), copyShareUrl: vi.fn(async () => ''),
    exportJsonSnapshot: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  copyCode.mockReset();
  useCircuitStore.setState({
    snapshot: { framework: 'qiskit', qubit_count: 1, classical_bit_count: 0, depth: 1, gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }] },
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function pick(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /export/i }));
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name })); });
}

describe('ExportMenu', () => {
  it('is a real menu button with arrow-key operable items', () => {
    render(<ExportMenu />);
    const trigger = screen.getByRole('button', { name: /export/i });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(trigger);
    expect(screen.getAllByRole('menuitem').length).toBe(7);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('confirms a copy with a brief status that clears itself', async () => {
    copyCode.mockResolvedValue(undefined);
    render(<ExportMenu />);
    await pick('Copy code');
    expect(screen.getByRole('status').textContent).toBe('Code copied');
    act(() => { vi.advanceTimersByTime(COPIED_NOTICE_MS + 10); });
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('swaps the trigger label to Copied instead of laying a box over the diagram', async () => {
    copyCode.mockResolvedValue(undefined);
    render(<ExportMenu />);
    await pick('Copy code');
    expect(screen.getByRole('button', { name: /copied/i })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(COPIED_NOTICE_MS + 10); });
    expect(screen.getByRole('button', { name: /export/i })).toBeTruthy();
  });

  it('reports a blocked clipboard instead of swallowing the error', async () => {
    copyCode.mockRejectedValue(new Error('denied'));
    render(<ExportMenu />);
    await pick('Copy code');
    expect(screen.getByRole('status').textContent).toBe("Couldn't copy: clipboard blocked");
  });

  it('renders nothing before there is a circuit', () => {
    useCircuitStore.setState({ snapshot: null });
    const { container } = render(<ExportMenu />);
    expect(container.textContent).toBe('');
  });
});

const staleSnap = { framework: 'qiskit' as const, qubit_count: 1, classical_bit_count: 0, depth: 1, gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }] };

describe('ExportMenu while the diagram is stale (r7-research-04)', () => {
  function goStale() {
    act(() => { useCircuitStore.getState().setSnapshot(null); useCircuitStore.getState().setPreviewPaused(true); });
  }

  it('stays focusable so the reason shows on keyboard focus, and refuses to open', () => {
    render(<ExportMenu />);
    act(() => { useCircuitStore.getState().setSnapshot(staleSnap); });
    goStale();
    const trigger = screen.getByRole('button', { name: /export/i });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    fireEvent.focus(trigger);
    act(() => { vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY_MS + 10); });
    expect(screen.getByRole('tooltip').textContent).toBe('Run the code to export');
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('exportDisabledReason', () => {
  it('points at the failing line when there is a code error', () => {
    expect(exportDisabledReason({ errorLine: 8, previewPaused: false })).toBe('Fix line 8 to export');
  });
  it('asks for a Run, not a fix, while the preview is merely paused', () => {
    expect(exportDisabledReason({ errorLine: null, previewPaused: true })).toBe('Run the code to export');
  });
  it('falls back to a generic code-error hint', () => {
    expect(exportDisabledReason({ errorLine: null, previewPaused: false })).toBe('Fix the code error to export');
  });
});
