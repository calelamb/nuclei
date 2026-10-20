import { create } from 'zustand';

/**
 * A one-shot request to scroll the editor to a 1-based source line and flash a
 * highlight on it. `nonce` makes repeat requests for the same line distinct so
 * clicking the same fault twice re-highlights.
 */
export interface RevealRequest {
  line: number;
  nonce: number;
}

interface EditorRevealState {
  request: RevealRequest | null;
  revealLine(line: number): void;
  clear(): void;
}

let counter = 0;

export const useEditorRevealStore = create<EditorRevealState>((set) => ({
  request: null,
  revealLine: (line) => {
    if (!Number.isInteger(line) || line < 1) return;
    counter += 1;
    set({ request: { line, nonce: counter } });
  },
  clear: () => set({ request: null }),
}));

/** Clamp a requested line into the model's valid range (code may have shrunk). */
export function clampRevealLine(line: number, lineCount: number): number {
  return Math.min(Math.max(1, Math.trunc(line)), Math.max(1, lineCount));
}
