// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import { ProbabilityHistogram } from './ProbabilityHistogram';
import { useSimulationStore } from '../../stores/simulationStore';
import { useEditorStore } from '../../stores/editorStore';

const SCROLLBAR_PX = 6;

function manyOutcomes(qubits: number): Record<string, number> {
  const count = 2 ** qubits;
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [i.toString(2).padStart(qubits, '0'), 1 / count]));
}

function loadResult(qubits: number) {
  const probabilities = manyOutcomes(qubits);
  useSimulationStore.getState().setResult({
    state_vector: [], probabilities, measurements: probabilities, bloch_coords: [],
    execution_time_ms: 1, shot_count: 1024, metrics: {},
  });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  useSimulationStore.getState().clearResult();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<ProbabilityHistogram> show all', () => {
  it('renders the y axis outside the scrolling region', () => {
    loadResult(6);
    render(<ProbabilityHistogram />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    const axis = screen.getByTestId('histogram-yaxis');
    const scroller = screen.getByLabelText('Scrollable outcome bars');
    expect(scroller.contains(axis)).toBe(false);
  });

  it('pads the pinned axis by the horizontal scrollbar thickness so ticks match the bars', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('histogram-scroll__bars') ? 100 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('histogram-scroll__bars') ? 100 - SCROLLBAR_PX : 0;
    });
    loadResult(6);
    render(<ProbabilityHistogram />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    const base = 54 + 8;
    expect(screen.getByTestId('histogram-yaxis').style.paddingBottom).toBe(`${base + SCROLLBAR_PX}px`);
  });
});

describe('<ProbabilityHistogram> without a result (research-r-03)', () => {
  it('says Running… while a run is in flight instead of asking for a run', () => {
    useSimulationStore.getState().setRunning(true);
    render(<ProbabilityHistogram />);
    expect(screen.getByText('Running…')).toBeTruthy();
    expect(screen.queryByText(/Run a simulation to see results/)).toBeNull();
  });

  it('uses the shared "No results yet" state when idle', () => {
    render(<ProbabilityHistogram />);
    expect(screen.getByText('No results yet')).toBeTruthy();
  });
});

describe('<ProbabilityHistogram> honesty about the sample', () => {
  it('captions the chart with the sample shot count and flags a different next-run count', () => {
    loadResult(1);
    useSimulationStore.getState().setShots(1024);
    const { rerender } = render(<ProbabilityHistogram />);
    expect(screen.getByTestId('histogram-caption').textContent).toContain('Nuclei sample · 1,024 shots');
    expect(screen.queryByText(/Next run/)).toBeNull();
    act(() => useSimulationStore.getState().setShots(100));
    rerender(<ProbabilityHistogram />);
    expect(screen.getByText('Next run: 100 shots')).toBeTruthy();
    act(() => useSimulationStore.getState().setShots(1024));
  });

  it('shows the From last run notice and dims the bars when the code changed after the run', () => {
    useEditorStore.getState().setCode('qc.h(0)');
    useSimulationStore.setState({ runCode: 'qc.h(0)' });
    loadResult(1);
    const { container } = render(<ProbabilityHistogram />);
    expect(screen.queryByTestId('stale-result-notice')).toBeNull();
    expect(container.querySelector('.histogram-stale')).toBeNull();
    act(() => useEditorStore.getState().setCode('qc.x(0)'));
    expect(screen.getByTestId('stale-result-notice').textContent).toMatch(/From last run/);
    expect(container.querySelector('.histogram-stale')).not.toBeNull();
    expect(screen.getByTestId('histogram-caption').textContent).toMatch(/^.*Ran in 1 ms$/);
  });
});
