import { create } from 'zustand';
import type { SimulationResult } from '../types/quantum';

interface SimulationState {
  result: SimulationResult | null;
  isRunning: boolean;
  shots: number;
  terminalOutput: string[];
  setResult: (result: SimulationResult) => void;
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
  setRunning: (isRunning) => set({ isRunning }),
  setShots: (shots) => set({ shots }),
  addOutput: (line) => set((s) => ({ terminalOutput: [...s.terminalOutput, line] })),
  clearOutput: () => set({ terminalOutput: [] }),
}));
