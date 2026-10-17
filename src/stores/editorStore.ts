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

/** Where a kernel boot is, in human terms (web: Python stages; desktop: connect attempts). */
export interface KernelProgress {
  step: number;
  total: number;
  label: string;
  /**
   * 'stages' are real boot phases (web); 'attempts' are desktop connect retries,
   * which are not user-meaningful stages and must not read as "n of m".
   */
  kind?: 'stages' | 'attempts';
  /** 0..1 overall completion. */
  fraction: number;
}

interface EditorState {
  code: string;
  framework: Framework;
  /**
   * Last Python-family framework (qiskit/cirq/cuda-q) the editor held.
   * Maintained by setFramework so that leaving a Q# buffer can restore the
   * student's actual framework instead of hardcoding 'qiskit'.
   */
  lastPythonFramework: Framework;
  filePath: string | null;
  isDirty: boolean;
  kernelConnected: boolean;
  kernelReady: boolean;
  kernelStatus: KernelStatus;
  kernelError: string | null;
  kernelProgress: KernelProgress | null;
  errors: EditorError[];
  setCode: (code: string) => void;
  setFramework: (framework: Framework) => void;
  setFilePath: (path: string | null) => void;
  setIsDirty: (isDirty: boolean) => void;
  setKernelConnected: (connected: boolean) => void;
  setKernelReady: (ready: boolean) => void;
  setKernelStatus: (status: KernelStatus, error?: string | null) => void;
  setKernelProgress: (progress: KernelProgress | null) => void;
  setErrors: (errors: EditorError[]) => void;
  clearErrors: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  code: DEFAULT_CODE,
  framework: 'qiskit',
  lastPythonFramework: 'qiskit',
  filePath: null,
  isDirty: false,
  kernelConnected: false,
  kernelReady: false,
  kernelStatus: 'idle',
  kernelError: null,
  kernelProgress: null,
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
  setFramework: (framework) =>
    set(
      framework === 'qsharp'
        ? { framework }
        : { framework, lastPythonFramework: framework },
    ),
  setFilePath: (filePath) => set({ filePath, isDirty: false }),
  setIsDirty: (isDirty) => set({ isDirty }),
  setKernelConnected: (kernelConnected) => set({ kernelConnected }),
  setKernelReady: (kernelReady) => set({ kernelReady }),
  // Progress only means something while connecting; any other status ends it.
  setKernelStatus: (kernelStatus, kernelError = null) =>
    set((s) => ({
      kernelStatus,
      kernelError,
      kernelProgress: kernelStatus === 'connecting' ? s.kernelProgress : null,
    })),
  setKernelProgress: (kernelProgress) => set({ kernelProgress }),
  setErrors: (errors) => set({ errors }),
  clearErrors: () => set({ errors: [] }),
}));
