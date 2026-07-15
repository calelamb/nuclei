import { create } from 'zustand';
import type { RuffDiagnostic } from '../types/quantum';

/**
 * Dev tools Phase 4 — ruff diagnostics for the active buffer. Held separately
 * from `editorStore.errors` (kernel parse errors) so the two render as
 * independent Monaco marker owners without collision.
 */
export interface LintState {
  diagnostics: RuffDiagnostic[];
  setDiagnostics(diagnostics: RuffDiagnostic[]): void;
  clear(): void;
}

export const useLintStore = create<LintState>((set) => ({
  diagnostics: [],
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  clear: () => set({ diagnostics: [] }),
}));
