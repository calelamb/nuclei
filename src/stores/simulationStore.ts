import { create } from 'zustand';
import type { SimulationResult } from '../types/quantum';

// Cap terminal buffer to avoid unbounded memory growth and re-render cost
// when a user's code prints in a tight loop. Older lines are trimmed FIFO.
const MAX_TERMINAL_LINES = 500;

interface SimulationState {
  result: SimulationResult | null;
  isRunning: boolean;
  shots: number;
  terminalOutput: string[];
  setResult: (result: SimulationResult | null) => void;
  clearResult: () => void;
  setRunning: (running: boolean) => void;
  setShots: (shots: number) => void;
  addOutput: (line: string) => void;
  clearOutput: () => void;
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
  addOutput: (line) => set((s) => {
    const next = s.terminalOutput.length >= MAX_TERMINAL_LINES
      ? [...s.terminalOutput.slice(-(MAX_TERMINAL_LINES - 1)), line]
      : [...s.terminalOutput, line];
    return { terminalOutput: next };
  }),
  clearOutput: () => set({ terminalOutput: [] }),
}));
