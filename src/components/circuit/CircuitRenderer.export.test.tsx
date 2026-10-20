// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CircuitRenderer } from './CircuitRenderer';
import { useCircuitStore } from '../../stores/circuitStore';
import { getCircuitSvgElement } from '../../hooks/useCircuitExport';

afterEach(() => cleanup());

describe('circuit export target', () => {
  beforeEach(() => {
    useCircuitStore.setState({
      snapshot: {
        framework: 'qiskit',
        qubit_count: 2,
        classical_bit_count: 0,
        depth: 2,
        gates: [
          { type: 'H', targets: [0], controls: [], params: [], layer: 0 },
          { type: 'CNOT', targets: [1], controls: [0], params: [], layer: 1 },
        ],
      },
    });
  });

  it('exposes the rendered diagram svg to the export hook', () => {
    render(<CircuitRenderer />);
    const svg = getCircuitSvgElement();
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('role')).toBe('img');
  });

  it('finds nothing when no circuit is rendered', () => {
    expect(getCircuitSvgElement()).toBeNull();
  });
});
