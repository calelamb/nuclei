// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import repetition from './__fixtures__/repetition_d3.json';
import surface from './__fixtures__/surface_d3.json';
import { DetectorGraphPanel } from './DetectorGraphPanel';
import { CodeLatticePanel } from './CodeLatticePanel';
import { QecTimelinePanel } from './QecTimelinePanel';
import { useQecStore } from '../../stores/qecStore';
import { useCircuitStore } from '../../stores/circuitStore';
import type { CircuitSnapshot } from '../../types/quantum';
import type { QecSnapshot, QecDecodeSampleResult } from '../../types/qec';

// The detector graph's "Sample a shot" goes through the module sender.
const decodeSpy = vi.fn();
vi.mock('../../lib/qecDecodeSender', () => ({
  requestQecDecodeSample: (...args: unknown[]) => decodeSpy(...args),
  requestQecSnapshot: vi.fn(),
}));

const repQec = repetition.qec as QecSnapshot;
const repSnap = repetition.snapshot as CircuitSnapshot;
const surfQec = surface.qec as QecSnapshot;
const surfSnap = surface.snapshot as CircuitSnapshot;
const repDecode = repetition.decode as QecDecodeSampleResult;

function setStim(qec: QecSnapshot, snap: CircuitSnapshot) {
  useQecStore.setState({ snapshot: qec, circuitText: '# stim', decodeSample: null, decodePending: false });
  useCircuitStore.setState({ snapshot: snap });
}

afterEach(() => cleanup());
beforeEach(() => decodeSpy.mockClear());

describe('DetectorGraphPanel', () => {
  it('renders the graph canvas and a Sample-a-shot action when a DEM exists', () => {
    setStim(repQec, repSnap);
    const { container, getByRole } = render(<DetectorGraphPanel />);
    // The detector graph now draws on a canvas (was per-edge <line> SVG) so it
    // scales to tens of thousands of edges without reconciling that many DOM
    // nodes. The layout/edge math is covered in qecGeometry.test.ts.
    expect(container.querySelector('canvas')).toBeTruthy();
    const sample = getByRole('button', { name: 'Sample a shot' });
    fireEvent.click(sample);
    expect(decodeSpy).toHaveBeenCalledWith('# stim');
  });

  it('overlays fired detectors + matching after a decode sample', () => {
    setStim(repQec, repSnap);
    useQecStore.setState({ decodeSample: repDecode });
    const { getByText } = render(<DetectorGraphPanel />);
    // The overlay summary line reports the fired-detector count.
    expect(getByText(new RegExp(`${repDecode.syndrome.length} detector`))).toBeTruthy();
    expect(getByText(/no logical error/)).toBeTruthy();
  });

  it('shows a designed empty state when there is no detector error model', () => {
    setStim({ ...repQec, dem: null, dem_error: 'observable is not deterministic' }, repSnap);
    const { getByText } = render(<DetectorGraphPanel />);
    expect(getByText('No detector error model')).toBeTruthy();
    expect(getByText('observable is not deterministic')).toBeTruthy();
  });

  it('shows a truncation banner with counts + a full-graph render action', () => {
    setStim(
      { ...repQec, dem: { ...repQec.dem!, truncated: true, edges: [], boundary_edges: [] } },
      repSnap,
    );
    const { getByText } = render(<DetectorGraphPanel />);
    expect(getByText(/Graph truncated/)).toBeTruthy();
    // Truncated graphs can now be rendered in full client-side (WASM parser on
    // the kernel-forwarded DEM text); the button falls back to the kernel path
    // when the wasm is unavailable.
    expect(getByText('Render full graph')).toBeTruthy();
  });
});

describe('CodeLatticePanel', () => {
  it('draws the lattice with a tick scrubber when qubit coords exist (surface code)', () => {
    setStim(surfQec, surfSnap);
    const { container, getByLabelText } = render(<CodeLatticePanel />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(getByLabelText('Tick scrubber')).toBeTruthy();
    // data (circles) + measure (rects) both present.
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
  });

  it('hides gracefully (empty state) when the circuit has no qubit coords (repetition code)', () => {
    setStim(repQec, repSnap);
    const { getByText, container } = render(<CodeLatticePanel />);
    expect(getByText('No qubit coordinates')).toBeTruthy();
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });
});

describe('QecTimelinePanel', () => {
  it('renders gates with noise ops and a detector track', () => {
    setStim(repQec, repSnap);
    const { container, getByText } = render(<QecTimelinePanel />);
    expect(container.querySelector('svg')).toBeTruthy();
    // The bottom detector track label is present.
    expect(getByText('det')).toBeTruthy();
    // Dashed hazard rects exist for noise ops.
    const dashed = Array.from(container.querySelectorAll('rect')).filter(
      (r) => r.getAttribute('stroke-dasharray'),
    );
    expect(dashed.length).toBeGreaterThan(0);
  });
});
