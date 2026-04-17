import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';

describe('editorStore', () => {
  beforeEach(() => {
    useEditorStore.setState({
      code: useEditorStore.getInitialState().code,
      framework: 'qiskit',
      filePath: null,
      isDirty: false,
      kernelConnected: false,
      errors: [],
    });
  });

  it('initializes with default Qiskit code', () => {
    const { code, framework } = useEditorStore.getState();
    expect(code).toContain('from qiskit import QuantumCircuit');
    expect(framework).toBe('qiskit');
  });

  it('sets code and marks dirty', () => {
    useEditorStore.getState().setCode('import cirq');
    const { code, isDirty } = useEditorStore.getState();
    expect(code).toBe('import cirq');
    expect(isDirty).toBe(true);
  });

  it('preserves errors across keystrokes so markers do not flicker', () => {
    // The kernel is authoritative for error state — it clears errors on the
    // next successful snapshot. Wiping markers on every keystroke caused a
    // flash between typing and the next debounced parse.
    useEditorStore.getState().setErrors([{ line: 1, message: 'syntax error' }]);
    expect(useEditorStore.getState().errors).toHaveLength(1);

    useEditorStore.getState().setCode('still typing');
    expect(useEditorStore.getState().errors).toHaveLength(1);

    useEditorStore.getState().clearErrors();
    expect(useEditorStore.getState().errors).toHaveLength(0);
  });

  it('tracks kernel connection state', () => {
    expect(useEditorStore.getState().kernelConnected).toBe(false);
    useEditorStore.getState().setKernelConnected(true);
    expect(useEditorStore.getState().kernelConnected).toBe(true);
  });
});
