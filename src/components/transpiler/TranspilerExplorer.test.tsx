// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TranspilerExplorer } from './TranspilerExplorer';
import { TranspilerControls } from './TranspilerControls';
import { useEditorStore } from '../../stores/editorStore';
import { useTranspileStore } from '../../stores/transpileStore';
import { setTranspileSender } from '../../lib/transpileSender';

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
  });

  it('on desktop a missing kernel reads as still starting, with no start instruction', () => {
    platform.web = false;
    render(<TranspilerControls />);
    fireEvent.click(screen.getByRole('button', { name: /Transpile/ }));
    expect(useTranspileStore.getState().error).toMatch(/still starting/);
    expect(useTranspileStore.getState().error).not.toMatch(/Start it/);
  });

  it('names the docs link', () => {
    platform.web = false;
    render(<TranspilerExplorer />);
    expect(screen.getByRole('link', { name: 'Transpiler docs' })).toBeTruthy();
  });
});
