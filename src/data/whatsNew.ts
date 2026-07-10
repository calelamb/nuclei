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
  version: '0.5.2',
  title: 'Dirac goes agentic',
  tagline: 'Dirac can now write, simulate, verify, and repair quantum programs — and reason about real hardware.',
  highlights: [
    {
      icon: 'dirac',
      title: 'Closed-loop coding',
      text: 'Give Dirac a goal and it writes a circuit, simulates it, checks the result, and fixes its own mistakes.',
    },
    {
      icon: 'circuit',
      title: 'Algorithm-aware verification',
      text: 'Dirac recognizes Bell, GHZ, and superposition circuits and checks them against their known-correct results.',
    },
    {
      icon: 'editor',
      title: 'Isolated, safe execution',
      text: 'Code Dirac runs executes in a disposable sandbox, walled off from your files and credentials.',
    },
    {
      icon: 'hardware',
      title: 'Real transpilation previews',
      text: "See a circuit's true depth and gate cost on a target backend before you ever submit.",
    },
    {
      icon: 'hardware',
      title: 'Explainable backend picks',
      text: 'Dirac recommends a compatible quantum backend and shows exactly why.',
    },
  ],
};
