// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ResultsEmptyState } from './ResultsEmptyState';
import { useSimulationStore } from '../../stores/simulationStore';
import { useEditorStore } from '../../stores/editorStore';

afterEach(() => {
  cleanup();
  useSimulationStore.setState({ isRunning: false });
  useEditorStore.setState({ kernelInstalling: null });
});

describe('ResultsEmptyState while a run waits behind a package install', () => {
  it('says Installing Cirq…, the same words as the status bar, not Running…', () => {
    useSimulationStore.setState({ isRunning: true });
    useEditorStore.setState({ kernelInstalling: 'Cirq' });
    render(<ResultsEmptyState />);
    expect(screen.getByText('Installing Cirq…')).toBeTruthy();
    expect(screen.queryByText('Running…')).toBeNull();
  });

  it('says Running… once the install is done', () => {
    useSimulationStore.setState({ isRunning: true });
    render(<ResultsEmptyState />);
    expect(screen.getByText('Running…')).toBeTruthy();
  });
});
