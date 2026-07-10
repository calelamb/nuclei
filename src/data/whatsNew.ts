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
  version: '0.5.3',
  title: 'Dirac reaches the hardware',
  tagline: 'Dirac can now run circuits on quantum backends, on a native Rust core, with your API key kept in the system keychain.',
  highlights: [
    {
      icon: 'hardware',
      title: 'Agentic hardware runs',
      text: 'Dirac can submit circuits and monitor results — the free simulator now, real hardware once you enable it.',
    },
    {
      icon: 'dirac',
      title: 'A native Rust agent core',
      text: "Dirac's agent now runs on a native Rust runtime, with a tamper-proof budget and policy engine.",
    },
    {
      icon: 'editor',
      title: 'Your API key, in the keychain',
      text: 'Your Anthropic key now lives in the operating-system keychain instead of the browser.',
    },
    {
      icon: 'hardware',
      title: 'Off by default, on your terms',
      text: 'Autonomous paid-hardware submission stays off until you switch it on, with hard spend limits.',
    },
  ],
};
