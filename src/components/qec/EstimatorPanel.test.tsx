// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { EstimatorPanel } from './EstimatorPanel';
import { useEditorStore } from '../../stores/editorStore';
import { useQecEstimateStore } from '../../stores/qecEstimateStore';
import type { QecEstimate } from '../../types/qec';

// The "Run estimate" button goes through the module sender.
const estimateSpy = vi.fn();
vi.mock('../../lib/qecDecodeSender', () => ({
  requestQecEstimate: (...args: unknown[]) => estimateSpy(...args),
}));

const SAMPLE: QecEstimate = {
  physical_qubits: 1_234_567,
  runtime_ns: 28_000,
  rqops: 4_500_000,
  code_distance: 11,
  logical_error_rate: 3.2e-8,
  num_tfactories: 14,
  physical_qubits_algorithm: 200_000,
  physical_qubits_tfactories: 1_034_567,
  qubit_params: 'qubit_gate_ns_e3',
  qec_scheme: 'surface_code',
  formatted: { runtime: '28 microsecs' },
  full: { physicalCounts: { physicalQubits: 1_234_567 } },
};

afterEach(() => cleanup());
beforeEach(() => {
  estimateSpy.mockClear();
  useQecEstimateStore.getState().reset();
  useEditorStore.setState({ code: 'operation Main() : Unit {}', framework: 'qsharp', filePath: 'main.qs' });
});

describe('EstimatorPanel', () => {
  it('shows an empty state before the first estimate for a supported framework', () => {
    const { getByText, getByRole } = render(<EstimatorPanel />);
    expect(getByText(/No estimate yet/i)).toBeTruthy();
    expect(getByRole('button', { name: /Run estimate/i })).toBeTruthy();
  });

  it('sends the active Q# buffer with the chosen options when Run estimate is clicked', () => {
    const { getByRole } = render(<EstimatorPanel />);
    fireEvent.click(getByRole('button', { name: /Run estimate/i }));
    expect(estimateSpy).toHaveBeenCalledTimes(1);
    const [code, language, options] = estimateSpy.mock.calls[0];
    expect(code).toContain('operation Main');
    expect(language).toBe('qsharp');
    expect(options).toMatchObject({ qubit_params: 'qubit_gate_ns_e3', qec_scheme: 'surface_code' });
  });

  it('routes a Qiskit buffer through the qiskit language (kernel-side QASM 3 export)', () => {
    useEditorStore.setState({ code: 'from qiskit import QuantumCircuit', framework: 'qiskit', filePath: 'main.py' });
    const { getByRole } = render(<EstimatorPanel />);
    fireEvent.click(getByRole('button', { name: /Run estimate/i }));
    expect(estimateSpy.mock.calls[0][1]).toBe('qiskit');
  });

  it('renders headline numbers once a result lands', () => {
    useQecEstimateStore.setState({ result: SAMPLE, pending: false, error: null });
    const { getByText } = render(<EstimatorPanel />);
    expect(getByText('1.23M')).toBeTruthy(); // physical qubits, compacted
    expect(getByText('28 microsecs')).toBeTruthy(); // estimator's formatted runtime
    expect(getByText('11')).toBeTruthy(); // code distance
    expect(getByText('14')).toBeTruthy(); // T factories
  });

  it('surfaces an error message from the store', () => {
    useQecEstimateStore.setState({ error: 'No runnable entry operation found.', pending: false });
    const { getByText } = render(<EstimatorPanel />);
    expect(getByText(/No runnable entry operation/i)).toBeTruthy();
  });

  it('tells the user resource estimation is Q#/Qiskit-only for other frameworks', () => {
    useEditorStore.setState({ code: 'import cirq', framework: 'cirq', filePath: 'main.py' });
    const { getByText, queryByRole } = render(<EstimatorPanel />);
    expect(getByText(/supports Q# and Qiskit/i)).toBeTruthy();
    expect(queryByRole('button', { name: /Run estimate/i })).toBeNull();
  });
});
