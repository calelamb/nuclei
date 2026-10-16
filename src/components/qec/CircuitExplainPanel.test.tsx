// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { CircuitExplainPanel } from './CircuitExplainPanel';
import { useEditorStore } from '../../stores/editorStore';
import { useQecExplainStore } from '../../stores/qecExplainStore';
import { useEditorRevealStore } from '../../stores/editorRevealStore';
import { applyQecExplainError, applyQecExplainResult } from '../../lib/qecExplainMessages';
import { setQecExplainSender } from '../../lib/qecExplainSender';

const CODE = 'R 0\nH 0\nM 0\nDETECTOR rec[-1]\n';

const NONDET = {
  status: 'nondeterministic',
  sentence: 'Detector D0 is non-deterministic: the Z-basis reset (R) on qubit 0 (line 1, after 0 TICKs) anti-commutes.',
  line: 1,
  line_text: 'R 0',
  tick: 0,
  detector_indices: [0],
  operation: { description: 'Z-basis reset (R)', qubits: [0] },
  diagram_svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  stim_message: 'The circuit contains non-deterministic detectors.',
};

const MINW = {
  status: 'ok', sentence: 'The smallest undetected logical error found has weight 2.', weight: 2,
  num_detectors: 4, num_observables: 1, method: 'shortest_graphlike_error',
  faults: [
    { index: 0, located: true, tick: 1, qubits: [0, 1], gate: 'DEPOLARIZE2', pauli: 'X0*X1', line: 4, instruction: 'DEPOLARIZE2(0.01) 0 1' },
    { index: 1, located: true, tick: 2, qubits: [2], gate: 'X_ERROR', line: 9 },
  ],
};

function seed(result: unknown, forText = CODE) {
  useEditorStore.setState({ code: CODE, filePath: 'c.stim' });
  useQecExplainStore.setState({ result: result as never, forText, pending: false, error: null });
}

beforeEach(() => {
  useEditorRevealStore.getState().clear();
  useQecExplainStore.getState().reset();
});
afterEach(() => {
  cleanup();
  setQecExplainSender(null);
});

describe('CircuitExplainPanel', () => {
  it('renders the sentence, Stim diagram and fault table', () => {
    seed({ nondeterministic: NONDET, min_weight: MINW });
    const { getByText, getByAltText, getAllByRole } = render(<CircuitExplainPanel />);
    expect(getByText(/Detector D0 is non-deterministic/)).toBeTruthy();
    const img = getByAltText(/detector slice diagram/i) as HTMLImageElement;
    expect(img.src.startsWith('data:image/svg+xml')).toBe(true);
    expect(getByText('Weight 2')).toBeTruthy();
    expect(getAllByRole('row')).toHaveLength(3);
  });

  it('click-to-source requests the editor line for the cause and for each fault', () => {
    seed({ nondeterministic: NONDET, min_weight: MINW });
    const { getAllByRole } = render(<CircuitExplainPanel />);
    const buttons = getAllByRole('button', { name: /Jump to line/ });
    fireEvent.click(buttons[0]);
    expect(useEditorRevealStore.getState().request?.line).toBe(1);
    fireEvent.click(buttons[2]);
    expect(useEditorRevealStore.getState().request?.line).toBe(9);
  });

  it('disables line links and warns when the editor changed since the analysis', () => {
    seed({ nondeterministic: NONDET }, 'different text');
    const { getByRole, getByText } = render(<CircuitExplainPanel />);
    expect((getByRole('button', { name: 'Jump to line 1' }) as HTMLButtonElement).disabled).toBe(true);
    expect(getByText(/circuit changed since this analysis/i)).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Jump to line 1' }));
    expect(useEditorRevealStore.getState().request).toBeNull();
  });

  it('asks the kernel to explain the current editor text', () => {
    const sender = vi.fn();
    setQecExplainSender(sender);
    useEditorStore.setState({ code: CODE, filePath: 'c.stim' });
    const { getByRole } = render(<CircuitExplainPanel />);
    fireEvent.click(getByRole('button', { name: 'Explain circuit' }));
    expect(sender).toHaveBeenCalledWith(CODE, 'both');
  });

  it('refuses python buffers instead of sending them', () => {
    useEditorStore.setState({ code: 'import stim\n', filePath: 'a.py' });
    const { getByRole, getByText } = render(<CircuitExplainPanel />);
    expect((getByRole('button', { name: 'Explain circuit' }) as HTMLButtonElement).disabled).toBe(true);
    expect(getByText(/Open a .stim circuit/)).toBeTruthy();
  });

  it('shows kernel errors visibly as an alert', () => {
    useEditorStore.setState({ code: CODE, filePath: 'c.stim' });
    applyQecExplainError('Stim is not installed, so circuits cannot be explained in this environment.');
    const { getByRole } = render(<CircuitExplainPanel />);
    expect(getByRole('alert').textContent).toMatch(/Stim is not installed/);
  });

  it('shows a malformed kernel reply as a visible error, not a blank panel', () => {
    useEditorStore.setState({ code: CODE, filePath: 'c.stim' });
    applyQecExplainResult({ nondeterministic: { status: 'bogus', sentence: 's' } });
    const { getByRole } = render(<CircuitExplainPanel />);
    expect(getByRole('alert').textContent).toMatch(/malformed/);
  });

  it('states it is static analysis and offers no fix action', () => {
    seed({ nondeterministic: NONDET });
    const { getByText, queryByRole } = render(<CircuitExplainPanel />);
    expect(getByText(/says nothing about sampled data/)).toBeTruthy();
    expect(queryByRole('button', { name: /fix/i })).toBeNull();
  });

  it('links the declaring line of each named detector, separately from the collapse line', () => {
    seed({ nondeterministic: { ...NONDET, targets: ['D0'], declaration_lines: { D0: 4 } } });
    const { getByRole } = render(<CircuitExplainPanel />);
    fireEvent.click(getByRole('button', { name: 'Jump to D0 declaration at line 4' }));
    expect(useEditorRevealStore.getState().request?.line).toBe(4);
  });

  it('shows the REPEAT iteration a fault falls in', () => {
    const faults = [{ ...MINW.faults[0], iteration: 2 }, MINW.faults[1]];
    seed({ min_weight: { ...MINW, faults } });
    const { getByText } = render(<CircuitExplainPanel />);
    expect(getByText('iter 2')).toBeTruthy();
  });

  it('shows the lost-connection error while pending, instead of spinning forever', () => {
    useEditorStore.setState({ code: CODE, filePath: 'c.stim' });
    useQecExplainStore.getState().begin(CODE, 'r1');
    useQecExplainStore.getState().failPending('Kernel connection lost.');
    const { getByRole } = render(<CircuitExplainPanel />);
    expect(getByRole('alert').textContent).toMatch(/connection lost/);
    expect((getByRole('button', { name: 'Explain circuit' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
