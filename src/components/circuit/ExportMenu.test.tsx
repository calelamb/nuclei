// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useCircuitStore } from '../../stores/circuitStore';
import { ExportMenu, COPIED_NOTICE_MS } from './ExportMenu';

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
