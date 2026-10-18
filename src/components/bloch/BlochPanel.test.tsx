// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

const setViews = vi.fn();
const dispose = vi.fn();
const constructed = vi.fn();

vi.mock('./blochStage', () => ({
  BlochStage: class {
    constructor() { constructed(); }
    setViews = setViews;
    setPalette = vi.fn();
    resize = vi.fn();
    dispose = dispose;
  },
}));

let measured = { width: 332, height: 240 };
vi.mock('../../hooks/useElementSize', () => ({
  useElementSize: () => [() => {}, measured],
}));

import { BlochPanel } from './BlochPanel';
import { useSimulationStore } from '../../stores/simulationStore';

function setCoords(coords: Array<{ x: number; y: number; z: number }>) {
  useSimulationStore.setState({
    result: {
      state_vector: [], probabilities: {}, measurements: {}, bloch_coords: coords, execution_time_ms: 1,
    },
  });
}

beforeEach(() => {
  setViews.mockClear();
  dispose.mockClear();
  constructed.mockClear();
  measured = { width: 332, height: 240 };
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q }) as unknown as MediaQueryList);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useSimulationStore.setState({ result: null });
});

describe('BlochPanel', () => {
  it('shows the empty state before any run', () => {
    render(<BlochPanel />);
    expect(screen.getByText(/run your circuit to see each qubit/i)).toBeTruthy();
    expect(constructed).not.toHaveBeenCalled();
  });

  it('before any run, draws one sphere per qubit at |0> when given the circuit width (Balanced preset)', () => {
    render(<BlochPanel initialQubits={3} />);
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getAllByText('Initial state')).toHaveLength(3);
    expect(screen.queryByText(/run your circuit/i)).toBeNull();
  });

  it('a real result replaces the initial spheres', () => {
    setCoords([{ x: 0, y: 0, z: -1 }]);
    render(<BlochPanel initialQubits={3} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.queryByText('Initial state')).toBeNull();
  });

  it('labels a single qubit q0 so a lone card still says which qubit it is', () => {
    setCoords([{ x: 0, y: 0, z: 1 }]);
    render(<BlochPanel />);
    expect(screen.getByText('q0')).toBeTruthy();
  });

  it('draws every visible qubit on ONE shared stage', () => {
    setCoords([{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }]);
    render(<BlochPanel />);
    expect(constructed).toHaveBeenCalledTimes(1);
    const last = setViews.mock.calls.at(-1)?.[0] as unknown[];
    expect(last).toHaveLength(2);
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('explains an entangled qubit instead of showing an empty sphere', () => {
    measured = { width: 600, height: 300 };
    setCoords([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]);
    render(<BlochPanel />);
    expect(screen.getAllByText(/entangled · no single-qubit bloch vector/i).length).toBe(2);
    expect(screen.getAllByRole('img')[0].getAttribute('aria-label')).toMatch(/purity 0\.50/);
  });

  it('pages through many qubits and never mounts more than the cap', () => {
    setCoords(Array.from({ length: 18 }, () => ({ x: 0, y: 0, z: 1 })));
    render(<BlochPanel />);
    expect(constructed).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('img').length).toBeLessThanOrEqual(8);
    expect(screen.getByText(/of 18/)).toBeTruthy();
    const before = screen.getByText(/of 18/).textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Next qubits' }));
    expect(screen.getByText(/of 18/).textContent).not.toBe(before);
    expect(constructed).toHaveBeenCalledTimes(1);
  });

  it('tears the stage down on unmount', () => {
    setCoords([{ x: 0, y: 0, z: 1 }]);
    const { unmount } = render(<BlochPanel />);
    unmount();
    expect(dispose).toHaveBeenCalled();
  });
});
