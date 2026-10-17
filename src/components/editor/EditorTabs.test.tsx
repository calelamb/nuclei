// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const execute = vi.fn();
vi.mock('../../App', () => ({
  getExecute: () => execute,
  getFileOps: () => null,
}));

import { EditorTabs } from './EditorTabs';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { registerKernelStop } from '../../lib/kernelControl';

const tab = (path: string) => ({ path, content: '', savedContent: '', isDirty: false });

function setTabs(paths: string[], active: string) {
  useProjectStore.setState({ tabs: paths.map(tab), activeTabPath: active, projectRoot: '/proj' });
}

beforeEach(() => {
  execute.mockClear();
  useEditorStore.setState({ kernelReady: true, kernelStatus: 'ready', kernelError: null, kernelProgress: null });
  useSimulationStore.setState({ isRunning: false });
});
afterEach(() => {
  cleanup();
  registerKernelStop(null);
  useProjectStore.setState({ tabs: [], activeTabPath: null, projectRoot: null });
});

describe('EditorTabs tablist', () => {
  it('exposes each open file as a tab with a roving tabindex', () => {
    setTabs(['/proj/a.py', '/proj/b.py', '/proj/c.py'], '/proj/b.py');
    render(<EditorTabs />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('moves focus and selection with Left/Right/Home/End', () => {
    setTabs(['/proj/a.py', '/proj/b.py', '/proj/c.py'], '/proj/a.py');
    render(<EditorTabs />);
    const [a, b, c] = screen.getAllByRole('tab');
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(b);
    expect(useProjectStore.getState().activeTabPath).toBe('/proj/b.py');
    fireEvent.keyDown(b, { key: 'End' });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(c, { key: 'Home' });
    expect(document.activeElement).toBe(a);
  });

  it('the unsaved starter buffer is itself a tab', () => {
    useProjectStore.setState({ tabs: [], activeTabPath: null });
    render(<EditorTabs />);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });
});

describe('EditorTabs toolbar gating', () => {
  it('offers Run and the framework chip on a code file', () => {
    setTabs(['/proj/a.py'], '/proj/a.py');
    render(<EditorTabs />);
    expect(screen.getByRole('button', { name: /run simulation/i })).toBeTruthy();
    expect(screen.getByTitle(/^Framework/)).toBeTruthy();
  });

  it('hides framework, Launch and Run on a non-code file', () => {
    setTabs(['/proj/README.md'], '/proj/README.md');
    render(<EditorTabs />);
    expect(screen.queryByRole('button', { name: /run simulation/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /launch on hardware/i })).toBeNull();
    expect(screen.queryByTitle(/^Framework/)).toBeNull();
  });
});

describe('Run / Stop', () => {
  it('ignores a Stop click that lands right after the run started (double-click)', () => {
    const stop = vi.fn();
    registerKernelStop(stop);
    setTabs(['/proj/a.py'], '/proj/a.py');
    render(<EditorTabs />);
    act(() => { useSimulationStore.setState({ isRunning: true }); });
    const stopBtn = screen.getByRole('button', { name: /stop the running program/i });
    fireEvent.click(stopBtn, { detail: 2 });
    expect(stop).not.toHaveBeenCalled();
  });

  it('stops a long-running program on a deliberate click', () => {
    const stop = vi.fn();
    registerKernelStop(stop);
    vi.spyOn(performance, 'now').mockReturnValue(0);
    setTabs(['/proj/a.py'], '/proj/a.py');
    render(<EditorTabs />);
    act(() => { useSimulationStore.setState({ isRunning: true }); });
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    fireEvent.click(screen.getByRole('button', { name: /stop the running program/i }), { detail: 1 });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('shows a neutral, disabled Kernel failed slot instead of a third Retry', () => {
    useEditorStore.setState({ kernelReady: false, kernelStatus: 'failed', kernelError: 'boom' });
    setTabs(['/proj/a.py'], '/proj/a.py');
    render(<EditorTabs />);
    const btn = screen.getByRole('button', { name: /boom/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
