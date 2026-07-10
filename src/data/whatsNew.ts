/**
 * Release notes for the post-update "What's New" release moment.
 *
 * Data-driven on purpose: when shipping a new release, update WHATS_NEW with
 * the new version + highlights and the modal handles the rest (shown once
 * per version, desktop only, silent on fresh installs).
 */

export type WhatsNewIcon = 'qsharp' | 'circuit' | 'editor' | 'dirac' | 'hardware';

export interface WhatsNewHighlight {
  icon: WhatsNewIcon;
  title: string;
  text: string;
}

export interface WhatsNewEntry {
  version: string;
  title: string;
  /** Optional one-line subtitle shown under the title. */
  tagline?: string;
  highlights: WhatsNewHighlight[];
}

export const WHATS_NEW: WhatsNewEntry = {
  version: '0.5.1',
  title: 'Sharper edges, fixed',
  tagline: 'A cleanup release — hardware, Bloch, Dirac, and Q# all get more trustworthy.',
  highlights: [
    {
      icon: 'hardware',
      title: 'No more haunted job strip',
      text: 'Stale failed jobs no longer linger in the launch strip after a run.',
    },
    {
      icon: 'hardware',
      title: 'Hardware connections that work',
      text: 'IBM and IonQ connections configured from Settings actually authenticate now.',
    },
    {
      icon: 'circuit',
      title: 'Bloch sphere, correctly ordered',
      text: 'Qiskit qubits map to the right axes on the Bloch sphere again.',
    },
    {
      icon: 'dirac',
      title: 'Dirac settings that apply',
      text: 'Model, thinking mode, and context depth changes now actually take effect.',
    },
    {
      icon: 'qsharp',
      title: 'Runaway Q# times out cleanly',
      text: 'Long-running Q# programs stop with a clear message instead of hanging.',
    },
  ],
};
