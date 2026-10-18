export interface CircuitHintContext {
  readonly projectOpen: boolean;
  readonly studyCount: number;
  readonly hasActiveStudy: boolean;
  readonly circuitCount: number;
}

/** What to do next to get a circuit on the canvas, depending on how far the researcher already is. */
export function circuitHint({ projectOpen, studyCount, hasActiveStudy, circuitCount }: CircuitHintContext): string {
  if (!projectOpen) return 'Open a project folder to load circuits.';
  if (!hasActiveStudy) {
    return studyCount > 0 ? 'Choose a Study to see its circuit.' : 'Create a Study to attach a .stim circuit.';
  }
  return circuitCount > 1 ? 'Double-click a .stim file under Referenced files to open it.' : 'This Study references no .stim circuit.';
}
