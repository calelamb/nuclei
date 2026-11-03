/**
 * Release notes for the post-update "What's New" release moment.
 *
 * Data-driven on purpose: when shipping a new release, update WHATS_NEW with
 * the new version + highlights and the modal handles the rest (shown once
 * per version, desktop only, silent on fresh installs).
 */

export type WhatsNewIcon = 'security' | 'chart' | 'statistics' | 'analysis' | 'agent';

export type WhatsNewPlatform = 'desktop' | 'web';
export type WhatsNewMode = 'learn' | 'research';

export interface WhatsNewHighlight {
  icon: WhatsNewIcon;
  title: string;
  text: string;
  /** Only show where the feature exists. Omit = every platform. */
  platforms?: readonly WhatsNewPlatform[];
  /** Only show in the workspaces the feature belongs to. Omit = both. */
  modes?: readonly WhatsNewMode[];
}

export interface WhatsNewHeadline {
  title: string;
  /** Optional one-line subtitle shown under the title. */
  tagline?: string;
}

export interface WhatsNewEntry {
  version: string;
  title: string;
  /** Optional one-line subtitle shown under the title. */
  tagline?: string;
  /** Headline per workspace, for releases whose main story differs between Learn and Research. */
  modeHeadlines?: Partial<Record<WhatsNewMode, WhatsNewHeadline>>;
  /** Tagline for the web build, which has no local kernel to harden. */
  webTagline?: string;
  highlights: WhatsNewHighlight[];
}

/** The title and subtitle that describe what this reader will actually see in the list below. */
export function headlineFor(
  entry: WhatsNewEntry,
  context: { platform: WhatsNewPlatform; mode: WhatsNewMode },
): WhatsNewHeadline {
  const modeHeadline = entry.modeHeadlines?.[context.mode];
  if (modeHeadline) return modeHeadline;
  const tagline = context.platform === 'web' ? entry.webTagline ?? entry.tagline : entry.tagline;
  return { title: entry.title, tagline };
}

/** The highlights that apply to this platform and workspace: nobody is told about a feature they cannot use. */
export function highlightsFor(
  entry: WhatsNewEntry,
  context: { platform: WhatsNewPlatform; mode: WhatsNewMode },
): WhatsNewHighlight[] {
  return entry.highlights.filter(
    (h) => (!h.platforms || h.platforms.includes(context.platform)) && (!h.modes || h.modes.includes(context.mode)),
  );
}

export const WHATS_NEW: WhatsNewEntry = {
  version: '0.16.0',
  title: 'Quantum machine learning in the Trainability Lab',
  tagline: 'Train quantum classifiers and kernels beside your trainability research, with classical baselines keeping every number honest.',
  webTagline: 'A refreshed workspace for your quantum circuits.',
  modeHeadlines: {
    learn: {
      title: 'Quantum ML to explore',
      tagline: 'See how quantum models learn from data, right alongside your circuits.',
    },
  },
  highlights: [
    {
      icon: 'analysis',
      title: 'Train a variational quantum classifier',
      text: 'Name your encoding parameters x0, x1 and train the rest: variational training with Adam, gradient descent or SPSA, exact adjoint or parameter-shift gradients, and a full loss history.',
      platforms: ['desktop'],
      modes: ['research'],
    },
    {
      icon: 'statistics',
      title: 'Quantum kernels, checked against classical',
      text: 'The fidelity quantum kernel comes with ridge accuracy and centred alignment, plus a classical RBF baseline on the identical split and a plain verdict on which kernel wins.',
      platforms: ['desktop'],
      modes: ['research'],
    },
    {
      icon: 'chart',
      title: 'Feature maps that learn, and natural gradients',
      text: 'Kernel-alignment search tunes your feature map against the labels, and quantum natural gradient preconditions training with the Fubini–Study metric.',
      platforms: ['desktop'],
      modes: ['research'],
    },
    {
      icon: 'security',
      title: 'Simulated device noise',
      text: 'Add finite shots, depolarizing noise and readout flips to gradients, kernels and training, labelled honestly as a simulated channel, never a device calibration.',
      platforms: ['desktop'],
      modes: ['research'],
    },
    {
      icon: 'analysis',
      title: 'Quantum machine learning arrives',
      text: 'Four built-in datasets (moons, circles, blobs, xor) let you train and compare quantum models end to end, locally and deterministically for a given seed.',
      platforms: ['desktop'],
    },
  ],
};
