import { create } from 'zustand';
import type { Framework } from '../types/quantum';

export interface EditorError {
  line: number;
  message: string;
}

interface EditorState {
  code: string;
  framework: Framework;
  filePath: string | null;
  isDirty: boolean;
  kernelConnected: boolean;
  errors: EditorError[];
  setCode: (code: string) => void;
  setFramework: (framework: Framework) => void;
  setFilePath: (path: string | null) => void;
  setKernelConnected: (connected: boolean) => void;
  setErrors: (errors: EditorError[]) => void;
  clearErrors: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  code: `from qiskit import QuantumCircuit

# Create a Bell State
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
`,
  framework: 'qiskit',
  filePath: null,
  isDirty: false,
  kernelConnected: false,
  errors: [],
  setCode: (code) => set({ code, isDirty: true, errors: [] }),
  setFramework: (framework) => set({ framework }),
  setFilePath: (filePath) => set({ filePath, isDirty: false }),
  setKernelConnected: (kernelConnected) => set({ kernelConnected }),
  setErrors: (errors) => set({ errors }),
  clearErrors: () => set({ errors: [] }),
}));
