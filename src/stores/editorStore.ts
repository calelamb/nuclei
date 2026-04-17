import { create } from 'zustand';
import type { Framework } from '../types/quantum';

export interface EditorError {
  line: number;
  message: string;
}

const DEFAULT_CODE = `from qiskit import QuantumCircuit

# Create a Bell State
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
`;

export type KernelStatus = 'idle' | 'connecting' | 'ready' | 'failed';

interface EditorState {
  code: string;
  framework: Framework;
  filePath: string | null;
  isDirty: boolean;
  kernelConnected: boolean;
  kernelReady: boolean;
  kernelStatus: KernelStatus;
  kernelError: string | null;
  errors: EditorError[];
  setCode: (code: string) => void;
  setFramework: (framework: Framework) => void;
  setFilePath: (path: string | null) => void;
  setKernelConnected: (connected: boolean) => void;
  setKernelReady: (ready: boolean) => void;
  setKernelStatus: (status: KernelStatus, error?: string | null) => void;
  setErrors: (errors: EditorError[]) => void;
  clearErrors: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  code: DEFAULT_CODE,
  framework: 'qiskit',
  filePath: null,
  isDirty: false,
  kernelConnected: false,
  kernelReady: false,
  kernelStatus: 'idle',
  kernelError: null,
  errors: [],
  setCode: (code) => {
    // Don't re-mark as dirty if the user hasn't actually changed anything
    // (e.g. restoring the same default text).
    const prev = get();
    const nextDirty = prev.filePath ? code !== prev.code || prev.isDirty : code !== DEFAULT_CODE;
    // Preserve existing errors — the kernel will resend an authoritative set
    // after the next parse. Wiping on every keystroke caused marker flicker.
    set({ code, isDirty: nextDirty });
  },
  setFramework: (framework) => set({ framework }),
  setFilePath: (filePath) => set({ filePath, isDirty: false }),
  setKernelConnected: (kernelConnected) => set({ kernelConnected }),
  setKernelReady: (kernelReady) => set({ kernelReady }),
  setKernelStatus: (kernelStatus, kernelError = null) => set({ kernelStatus, kernelError }),
  setErrors: (errors) => set({ errors }),
  clearErrors: () => set({ errors: [] }),
}));
