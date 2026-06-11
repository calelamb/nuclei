/**
 * Release notes for the post-update "What's New" card.
 *
 * Data-driven on purpose: when shipping a new release, update WHATS_NEW with
 * the new version + highlights and the card handles the rest (shown once per
 * version, desktop only, silent on fresh installs).
 */

export type WhatsNewIcon = 'qsharp' | 'circuit' | 'editor' | 'dirac' | 'hardware';

export interface WhatsNewEntry {
  version: string;
  title: string;
  highlights: Array<{ icon: WhatsNewIcon; text: string }>;
}

export const WHATS_NEW: WhatsNewEntry = {
  version: '0.5.1',
  title: 'Sharper edges, fixed',
  highlights: [
    { icon: 'hardware', text: 'Stale failed jobs no longer haunt the launch strip' },
    { icon: 'hardware', text: 'IBM and IonQ connections from Settings actually work now' },
    { icon: 'circuit', text: 'Bloch sphere shows Qiskit qubits in the right order' },
    { icon: 'dirac', text: 'Dirac settings (model, thinking, context depth) now apply' },
    { icon: 'qsharp', text: 'Runaway Q# programs time out with a clear message' },
  ],
};
