// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useActiveTabSync } from './useActiveTabSync';
import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';

const QS_SOURCE = 'operation Main() : Unit {}';
const PY_SOURCE = 'from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\n';

function resetStores() {
  useProjectStore.setState({ projectRoot: null, tabs: [], activeTabPath: null });
  useEditorStore.setState({
    code: '',
    framework: 'qiskit',
    lastPythonFramework: 'qiskit',
    filePath: null,
    isDirty: false,
  });
}

describe('useActiveTabSync — Q# framework inference', () => {
  beforeEach(resetStores);
  afterEach(() => {
    cleanup();
    resetStores();
  });

  it('flips the framework to qsharp when a .qs tab activates', () => {
    renderHook(() => useActiveTabSync());

    act(() => {
      useProjectStore.getState().openTab({ path: 'memory://p/bell.qs', content: QS_SOURCE });
    });

    expect(useEditorStore.getState().framework).toBe('qsharp');
    expect(useEditorStore.getState().code).toBe(QS_SOURCE);
  });

  it('drops back to a Python framework when leaving Q# for a .py tab', () => {
    renderHook(() => useActiveTabSync());

    act(() => {
      useProjectStore.getState().openTab({ path: 'memory://p/bell.qs', content: QS_SOURCE });
    });
    act(() => {
      useProjectStore.getState().openTab({ path: 'memory://p/lecture.py', content: PY_SOURCE });
    });

    // 'qiskit' is the default lastPythonFramework — the kernel's snapshot
    // feedback refines it (e.g. to cirq) after the next parse.
    expect(useEditorStore.getState().framework).toBe('qiskit');
  });

  it('restores the last Python framework (not hardcoded qiskit) when leaving Q#', () => {
    renderHook(() => useActiveTabSync());

    act(() => {
      useEditorStore.getState().setFramework('cirq');
    });
    act(() => {
      useProjectStore.getState().openTab({ path: 'memory://p/bell.qs', content: QS_SOURCE });
    });
    expect(useEditorStore.getState().framework).toBe('qsharp');

    act(() => {
      useProjectStore.getState().openTab({ path: 'memory://p/lecture.py', content: PY_SOURCE });
    });
    expect(useEditorStore.getState().framework).toBe('cirq');
  });

  it('leaves a Python framework alone when switching between Python tabs', () => {
    renderHook(() => useActiveTabSync());
    act(() => {
      useEditorStore.getState().setFramework('cirq');
    });

    act(() => {
      useProjectStore.getState().openTab({ path: 'memory://p/a.py', content: PY_SOURCE });
    });

    expect(useEditorStore.getState().framework).toBe('cirq');
  });
});
