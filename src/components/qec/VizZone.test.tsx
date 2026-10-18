// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import { VizZone } from './VizZone';
import { BlochEmptyState } from '../bloch/BlochEmptyState';
import { useQecStore } from '../../stores/qecStore';
import { useProjectStore } from '../../stores/projectStore';
import { useVizZoneStore } from '../../stores/vizZoneStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useEditorStore } from '../../stores/editorStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import type { VisiblePanels } from '../../layout/panelRegistry';
import surface from './__fixtures__/surface_d3.json';
import type { QecSnapshot } from '../../types/qec';

// Stub the heavy panel bodies so the test focuses on VizZone's tabbing/stacking.
vi.mock('../bloch/BlochPanel', () => ({ BlochPanel: ({ initialQubits }: { initialQubits?: number }) => <div data-testid="bloch" data-initial={initialQubits ?? 0} /> }));
vi.mock('./QecTimelinePanel', () => ({ QecTimelinePanel: () => <div data-testid="timeline" /> }));
vi.mock('./CodeLatticePanel', () => ({ CodeLatticePanel: () => <div data-testid="lattice" /> }));
vi.mock('./DetectorGraphPanel', () => ({ DetectorGraphPanel: () => <div data-testid="detector" /> }));

function visible(over: Partial<VisiblePanels>): VisiblePanels {
  return {
    circuit: false, bloch: false, histogramChip: false, histogramFull: false, terminal: false,
    qecTimeline: false, qecLattice: false, qecDetectorGraph: false, ...over,
  };
}

const surfQec = surface.qec as QecSnapshot;

afterEach(() => cleanup());
beforeEach(() => {
  localStorage.clear();
  useProjectStore.setState({ projectRoot: '/proj' });
  useQecStore.setState({ snapshot: null });
  useVizZoneStore.setState({ activeTabByProject: {} });
});

describe('<VizZone> (PRD 10 Phase D)', () => {
  it('non-stim: a single Bloch panel stacks (no tab strip) — the pre-Phase-D layout', () => {
    const { getByTestId, queryByRole } = render(<VizZone visible={visible({ bloch: true })} chip={null} />);
    expect(getByTestId('bloch')).toBeTruthy();
    expect(queryByRole('tablist')).toBeNull();
  });

  it('stim with >2 viz panels: the zone tabs, showing the first by default', () => {
    useQecStore.setState({ snapshot: surfQec }); // has qubit coords → lattice available
    const { getByRole, getByTestId, queryByTestId } = render(
      <VizZone
        visible={visible({ qecTimeline: true, qecLattice: true, qecDetectorGraph: true })}
        chip={null}
      />,
    );
    const tablist = getByRole('tablist', { name: 'Visualization panels' });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(3);
    // First tab (Timeline) active by default.
    expect(getByTestId('timeline')).toBeTruthy();
    expect(queryByTestId('detector')).toBeNull();
  });

  it('clicking a tab switches the panel and persists per project', () => {
    useQecStore.setState({ snapshot: surfQec });
    const { getByRole, getByTestId } = render(
      <VizZone
        visible={visible({ qecTimeline: true, qecLattice: true, qecDetectorGraph: true })}
        chip={null}
      />,
    );
    fireEvent.click(getByRole('tab', { name: 'Detector Graph' }));
    expect(getByTestId('detector')).toBeTruthy();
    // Persisted for this project.
    expect(useVizZoneStore.getState().activeTabFor('/proj')).toBe('qecDetectorGraph');
  });

  it('hides the code lattice when the circuit has no qubit coordinates', () => {
    // No coords → lattice filtered out, leaving 2 panels → stacked (no tabs).
    useQecStore.setState({ snapshot: { ...surfQec, coords: { ...surfQec.coords, qubits: surfQec.coords.qubits.map(() => null) } } });
    const { queryByRole, getByTestId, queryByTestId } = render(
      <VizZone
        visible={visible({ qecTimeline: true, qecLattice: true, qecDetectorGraph: true })}
        chip={null}
      />,
    );
    expect(queryByRole('tablist')).toBeNull(); // only 2 panels now
    expect(getByTestId('timeline')).toBeTruthy();
    expect(getByTestId('detector')).toBeTruthy();
    expect(queryByTestId('lattice')).toBeNull();
  });

  it('restores the remembered tab for a project', () => {
    useQecStore.setState({ snapshot: surfQec });
    useVizZoneStore.setState({ activeTabByProject: { '/proj': 'qecLattice' } });
    const { getByTestId } = render(
      <VizZone
        visible={visible({ qecTimeline: true, qecLattice: true, qecDetectorGraph: true })}
        chip={null}
      />,
    );
    expect(getByTestId('lattice')).toBeTruthy();
  });
});

describe('<VizZone> results empty state (shell-r3-05/07)', () => {
  beforeEach(() => {
    useSimulationStore.setState({ result: null, isRunning: false, lastRunFailed: false, lastRunNoCircuit: false });
    useEditorStore.setState({ errors: [] });
    useBottomPanelStore.setState({ collapsed: true });
  });

  it('Clean preset (circuit only) and Balanced preset (circuit + Bloch) show the same copy and the same Run action', () => {
    const clean = render(<VizZone visible={visible({ circuit: true })} chip={null} />);
    const resultsEmpty = (el: HTMLElement) => el.querySelector('.viz-results-empty .nuclei-empty')?.textContent;
    const cleanText = resultsEmpty(clean.container);
    expect(cleanText ?? '').toContain("Run your circuit to see each qubit's Bloch sphere and the outcome histogram.");
    expect(within(clean.container).getByRole('button', { name: /^Run/ })).toBeTruthy();
    cleanup();

    // The Bloch panel's own empty state (Balanced / Full presets) is the same component.
    const balanced = render(<BlochEmptyState />);
    expect(balanced.container.querySelector('.nuclei-empty')?.textContent).toBe(cleanText);
    expect(within(balanced.container).getByRole('button', { name: /^Run/ })).toBeTruthy();
  });

  it('a failed run says so instead of showing the first-run prompt, and offers the error and a retry', () => {
    useSimulationStore.setState({ lastRunFailed: true });
    useEditorStore.setState({ errors: [{ line: 12, message: 'boom' }] });
    const { container, getByRole, queryByText } = render(<VizZone visible={visible({ circuit: true })} chip={null} />);
    expect(container.textContent).toContain('Last run failed');
    expect(container.textContent).toContain('line\u00A012');
    expect(queryByText(/Run your circuit to see/)).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Show error' }));
    expect(useBottomPanelStore.getState().collapsed).toBe(false);
    expect(getByRole('button', { name: /Run again/ })).toBeTruthy();
  });

  it('a clean run with no circuit says so', () => {
    useSimulationStore.setState({ lastRunNoCircuit: true });
    const { container } = render(<VizZone visible={visible({ circuit: true })} chip={null} />);
    expect(container.textContent).toContain('No circuit in this file');
  });

  it('keeps the column for a plain-Python run even when no panel is visible', () => {
    useSimulationStore.setState({ lastRunNoCircuit: true });
    const { container } = render(<VizZone visible={visible({})} chip={null} noCircuit />);
    expect(container.textContent).toContain('No circuit in this file');
  });

  it('keeps the running variant', () => {
    useSimulationStore.setState({ isRunning: true });
    const { container } = render(<VizZone visible={visible({ circuit: true })} chip={null} />);
    expect(container.querySelector('.viz-results-empty')?.textContent).toContain('Running');
  });
});

describe('<VizZone> initial spheres in Balanced', () => {
  it('draws no initial spheres once a run has failed', async () => {
    const { useLayoutStore } = await import('../../stores/layoutStore');
    const { useCircuitStore } = await import('../../stores/circuitStore');
    useLayoutStore.setState({ preset: 'balanced' });
    useCircuitStore.setState({ snapshot: { framework: 'qiskit', qubit_count: 2, classical_bit_count: 0, depth: 1, gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }] } });
    useSimulationStore.setState({ result: null, lastRunFailed: false });
    const ok = render(<VizZone visible={visible({ circuit: true, bloch: true })} chip={null} />);
    expect(ok.queryByTestId('bloch')?.getAttribute('data-initial')).toBe('2');
    cleanup();
    useSimulationStore.setState({ lastRunFailed: true });
    const failed = render(<VizZone visible={visible({ circuit: true, bloch: true })} chip={null} />);
    expect(failed.queryByTestId('bloch')?.getAttribute('data-initial') ?? '0').toBe('0');
    useSimulationStore.setState({ lastRunFailed: false });
    useLayoutStore.setState({ preset: 'clean' });
  });
});

describe('<VizZone> when Python did not start (shell-r3-06)', () => {
  it('keeps the column with a calm placeholder and a Retry that restarts the kernel', async () => {
    const control = await import('../../lib/kernelControl');
    const retry = vi.fn();
    control.registerKernelRetry(retry);
    const { container, getByRole } = render(<VizZone visible={visible({})} chip={null} startFailed />);
    expect(container.textContent).toMatch(/(Kernel|Python) didn't start/);
    expect(container.textContent).toContain('see the banner above for details');
    fireEvent.click(getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    control.registerKernelRetry(null);
  });
});

describe('<VizZone> while Python boots', () => {
  it('puts the step in the title and keeps the body to one sentence', () => {
    useEditorStore.setState({ kernelProgress: { step: 1, total: 3, label: 'Downloading Python', fraction: 0 } });
    const { container } = render(<VizZone visible={visible({})} chip={null} booting />);
    expect(container.textContent).toContain('Preparing Python (step 1 of 3)');
    expect(container.textContent).toContain('Circuit and results appear when it');
    expect(container.textContent).not.toMatch(/·\s*1\/3/);
    useEditorStore.setState({ kernelProgress: null });
  });
});
