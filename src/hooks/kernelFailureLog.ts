import { useSimulationStore } from '../stores/simulationStore';

/**
 * Write a kernel start/connect failure to the Terminal, unless the Terminal's last line already says
 * exactly that. Two connect generations (a dev re-mount, a Retry racing a late socket) can each give up
 * with the same message; the user should read it once.
 */
export function logKernelFailureOnce(message: string): void {
  const line = `Error: ${message}`;
  const { terminalOutput, addOutput } = useSimulationStore.getState();
  const last = terminalOutput[terminalOutput.length - 1];
  if (last && last.type === 'stderr' && last.text === line) return;
  addOutput(line, 'stderr');
}
