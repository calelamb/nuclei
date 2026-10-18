import { create } from 'zustand';
import type { SimulationResult } from '../types/quantum';

// Cap terminal buffer to avoid unbounded memory growth and re-render cost
// when a user's code prints in a tight loop. Older lines are trimmed FIFO.
const MAX_TERMINAL_LINES = 2000;

// Strip ANSI color escapes (Qiskit/Cirq can emit these in tracebacks).
// eslint-disable-next-line no-control-regex -- the ANSI escape we're matching IS a control char
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export type TerminalLineType = 'stdout' | 'stderr' | 'separator' | 'info' | 'summary';

export interface TerminalLine {
  text: string;
  type: TerminalLineType;
  timestamp: number;
}

interface SimulationState {
  result: SimulationResult | null;
  /** The code of the run in flight (set by `beginRun`), promoted to `resultCode` when its result lands. */
  runCode: string | null;
  /** The exact code that produced `result`; null when unknown (never reported stale). */
  resultCode: string | null;
  isRunning: boolean;
  /** The last run ended in an error; cleared when a new run starts or a result lands. */
  lastRunFailed: boolean;
  /** The last run finished cleanly but defined no circuit (plain Python); cleared when a new run starts or a result lands. */
  lastRunNoCircuit: boolean;
  shots: number;
  terminalOutput: TerminalLine[];
  /** Record the code being executed so its result can later be recognised as out of date. */
  beginRun: (code: string) => void;
  setResult: (result: SimulationResult | null) => void;
  clearResult: () => void;
  setRunning: (running: boolean) => void;
  setRunFailed: (failed: boolean) => void;
  setRunNoCircuit: (noCircuit: boolean) => void;
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

/** True when a result exists and was produced by code other than `currentCode`. */
export function isResultStale(resultCode: string | null, currentCode: string, hasResult = true): boolean {
  return hasResult && resultCode !== null && resultCode !== currentCode;
}

/** Whether the Terminal holds anything the user would want to read (run separators and per-run summaries alone do not count). */
export function hasMeaningfulOutput(lines: readonly TerminalLine[]): boolean {
  return lines.some((l) => l.type !== 'separator' && l.type !== 'summary');
}

export const useSimulationStore = create<SimulationState>((set) => ({
  result: null,
  runCode: null,
  resultCode: null,
  isRunning: false,
  lastRunFailed: false,
  lastRunNoCircuit: false,
  shots: 1024,
  terminalOutput: [],
  beginRun: (runCode) => set({ runCode }),
  setResult: (result) => set((s) => ({
    result,
    resultCode: result ? s.runCode : null,
    isRunning: false,
    lastRunFailed: result ? false : s.lastRunFailed,
    lastRunNoCircuit: result ? false : s.lastRunNoCircuit,
  })),
  clearResult: () => set({ result: null, resultCode: null, isRunning: false }),
  setRunning: (isRunning) => set((s) => ({
    isRunning,
    lastRunFailed: isRunning ? false : s.lastRunFailed,
    lastRunNoCircuit: isRunning ? false : s.lastRunNoCircuit,
  })),
  setRunFailed: (lastRunFailed) => set({ lastRunFailed }),
  setRunNoCircuit: (lastRunNoCircuit) => set({ lastRunNoCircuit }),
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
