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
  version: '0.6.0',
  title: 'Research mode',
  tagline: 'A second workspace for people doing quantum computing: parameter sweeps, reproducible runs, and comparison — Learn mode stays exactly as it was.',
  highlights: [
    {
      icon: 'circuit',
      title: 'Experiments as first-class objects',
      text: 'Declare a parameter sweep in a plain YAML file, hit Run, and watch results stream into a sortable runs table.',
    },
    {
      icon: 'qsharp',
      title: 'Reproducible by design',
      text: "Every run writes a manifest — params, seed, code hash, git commit, framework versions — honest about what it can and can't reproduce.",
    },
    {
      icon: 'editor',
      title: 'Compare runs and plot sweeps',
      text: 'Overlay histograms, diff manifests, and chart any metric against a swept parameter without leaving the IDE.',
    },
    {
      icon: 'dirac',
      title: 'Dirac, the research collaborator',
      text: 'Switch modes and Dirac drops the tutor tone for terse, precise answers grounded in your active experiment.',
    },
  ],
};
