// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import { VizZone } from './VizZone';
import { useQecStore } from '../../stores/qecStore';
import { useProjectStore } from '../../stores/projectStore';
import { useVizZoneStore } from '../../stores/vizZoneStore';
import type { VisiblePanels } from '../../layout/panelRegistry';
import surface from './__fixtures__/surface_d3.json';
import type { QecSnapshot } from '../../types/qec';

// Stub the heavy panel bodies so the test focuses on VizZone's tabbing/stacking.
vi.mock('../bloch/BlochPanel', () => ({ BlochPanel: () => <div data-testid="bloch" /> }));
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
