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
  version: '0.5.0',
  title: 'Q# has landed',
  highlights: [
    { icon: 'qsharp', text: "Write Q# — Microsoft's quantum language, now built in" },
    { icon: 'circuit', text: 'Live circuits, Bloch sphere & histograms for Q# programs' },
    { icon: 'editor', text: 'Real QDK compiler intelligence: diagnostics, completions, hover' },
    { icon: 'dirac', text: 'Dirac speaks fluent Q#' },
    { icon: 'hardware', text: 'Launch Q# straight to Azure Quantum hardware' },
  ],
};
