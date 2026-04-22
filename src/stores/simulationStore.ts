import { create } from 'zustand';
import type { SimulationResult } from '../types/quantum';

// Cap terminal buffer to avoid unbounded memory growth and re-render cost
// when a user's code prints in a tight loop. Older lines are trimmed FIFO.
const MAX_TERMINAL_LINES = 500;

// Strip ANSI color escapes (Qiskit/Cirq can emit these in tracebacks).
// eslint-disable-next-line no-control-regex -- the ANSI escape we're matching IS a control char
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export type TerminalLineType = 'stdout' | 'stderr' | 'separator' | 'info';

export interface TerminalLine {
  text: string;
  type: TerminalLineType;
  timestamp: number;
}

interface SimulationState {
  result: SimulationResult | null;
  isRunning: boolean;
  shots: number;
  terminalOutput: TerminalLine[];
  setResult: (result: SimulationResult | null) => void;
  clearResult: () => void;
  setRunning: (running: boolean) => void;
  setShots: (shots: number) => void;
  addOutput: (text: string, type?: TerminalLineType) => void;
  clearOutput: () => void;
}

function normalizeIncoming(text: string): string[] {
  const stripped = text.replace(ANSI_PATTERN, '');
  const lines = stripped.split(/\r?\n/);
  // A trailing newline in the source (e.g. Python's print() default end='\n')
  // produces an empty final element — drop it so we don't render a phantom
  // blank line after every print. Intermediate empties are preserved.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length > 0 ? lines : [''];
}

function appendCapped(buffer: TerminalLine[], additions: TerminalLine[]): TerminalLine[] {
  const combined = buffer.length + additions.length;
  if (combined <= MAX_TERMINAL_LINES) {
    return [...buffer, ...additions];
  }
  const overflow = combined - MAX_TERMINAL_LINES;
  const trimmedBuffer = buffer.slice(overflow);
  return [...trimmedBuffer, ...additions];
}

export const useSimulationStore = create<SimulationState>((set) => ({
  result: null,
  isRunning: false,
  shots: 1024,
  terminalOutput: [],
  setResult: (result) => set({ result, isRunning: false }),
  clearResult: () => set({ result: null, isRunning: false }),
  setRunning: (isRunning) => set({ isRunning }),
  setShots: (shots) => set({ shots }),
  addOutput: (text, type = 'stdout') => set((s) => {
    const timestamp = Date.now();
    const texts = type === 'separator' ? [text] : normalizeIncoming(text);
    const additions: TerminalLine[] = texts.map((lineText) => ({
      text: lineText,
      type,
      timestamp,
    }));
    return { terminalOutput: appendCapped(s.terminalOutput, additions) };
  }),
  clearOutput: () => set({ terminalOutput: [] }),
}));
