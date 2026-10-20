// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TranspilerExplorer } from './TranspilerExplorer';
import { TranspilerControls } from './TranspilerControls';
import { useEditorStore } from '../../stores/editorStore';
import { useTranspileStore } from '../../stores/transpileStore';
import { setTranspileSender } from '../../lib/transpileSender';
import { registerKernelRetry } from '../../lib/kernelControl';

const platform = vi.hoisted(() => ({ web: false }));
vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => platform.web }));

describe('Transpiler Explorer platform honesty', () => {
  beforeEach(() => {
    useEditorStore.setState({ framework: 'qiskit', code: 'qc' });
    useTranspileStore.setState({ result: null, error: null, pending: false });
    setTranspileSender(null);
  });
  afterEach(cleanup);

  it('on the web build explains the explorer is desktop-only and never says to start a kernel', () => {
    platform.web = true;
    render(<><TranspilerControls /><TranspilerExplorer /></>);
    expect(screen.getByText('Transpiler Explorer runs in the desktop app')).toBeTruthy();
    expect(screen.getByText('Transpiling runs in the desktop app.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Download Nuclei/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Transpile$/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Start it/);
    expect(document.body.textContent).not.toMatch(/kernel/i);
  });

  it('titles the page with the shared pane header and an h1 (design-r8-02)', () => {
    platform.web = true;
    const { container } = render(<TranspilerExplorer />);
    expect(screen.getByRole('heading', { level: 1, name: 'Transpiler Explorer' })).toBeTruthy();
    expect(container.querySelector('.nuclei-pane-header')).toBeTruthy();
  });

  it('on desktop, Transpile is gated with a waiting label while the kernel starts (research-r-02)', () => {
    platform.web = false;
    useEditorStore.setState({ kernelStatus: 'connecting' });
    render(<TranspilerControls />);
    const button = screen.getByRole('button', { name: /Waiting for the kernel/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(useTranspileStore.getState().error).toBeNull();
  });

  it('on desktop a missing connection uses the shared sentence with no start instruction', () => {
    platform.web = false;
    useEditorStore.setState({ kernelStatus: 'ready' });
    render(<TranspilerControls />);
    fireEvent.click(screen.getByRole('button', { name: /Transpile/ }));
    expect(useTranspileStore.getState().error).toBe("The kernel isn't connected. Check the status bar, then try again.");
  });

  it('after a failed start, Transpile is disabled and named for the failed start, with a Retry beside it (research-r-17)', () => {
    platform.web = false;
    const retry = vi.fn();
    registerKernelRetry(retry);
    useEditorStore.setState({ kernelStatus: 'failed' });
    render(<TranspilerControls />);
    const button = screen.getByRole('button', { name: "Kernel didn't start" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /^Transpile$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalled();
    registerKernelRetry(null);
  });

  it('shows an engine failure as an alert with Retry that restarts the kernel', () => {
    platform.web = false;
    const retry = vi.fn();
    registerKernelRetry(retry);
    useEditorStore.setState({ kernelReady: false, kernelStatus: 'failed' });
    useTranspileStore.setState({ error: "The kernel isn't connected. Check the status bar, then try again." });
    render(<TranspilerExplorer />);
    expect(screen.getByRole('alert').textContent).toContain("The kernel isn't connected");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalled();
    registerKernelRetry(null);
  });

  it('offers no Retry while the engine is already reconnecting', () => {
    platform.web = false;
    useEditorStore.setState({ kernelReady: false, kernelStatus: 'connecting' });
    useTranspileStore.setState({ error: "The kernel isn't connected. Check the status bar, then try again." });
    render(<TranspilerExplorer />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('names the docs link', () => {
    platform.web = false;
    render(<TranspilerExplorer />);
    expect(screen.getByRole('link', { name: 'Transpiler docs' })).toBeTruthy();
  });
});
