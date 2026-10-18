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
  version: '0.14.0',
  title: 'QEC statistics you can cite',
  tagline: 'Drop a sinter CSV, get sinter-grade numbers with their uncertainty, and a kernel that no longer trusts every local process.',
  webTagline: 'Drop a sinter CSV and get sinter-grade numbers with their uncertainty.',
  modeHeadlines: {
    learn: {
      title: 'A clearer Dirac',
      tagline: 'Tables, quotes and readable formulas in Dirac replies, with a copy button on every code block.',
    },
  },
  highlights: [
    {
      icon: 'chart',
      title: 'Drop a sinter CSV to plot it',
      text: 'Drop a sinter stats CSV on the QEC Workbench for logical error rate vs p per distance. Read locally; nothing is uploaded.',
      modes: ['research'],
    },
    {
      icon: 'statistics',
      title: 'Sinter-grade statistics',
      text: 'Likelihood-ratio intervals, per-round rates, and a Λ estimate with a 95% interval and plain-language warnings when it is not defensible.',
      modes: ['research'],
    },
    {
      icon: 'analysis',
      title: 'Explain why this circuit fails',
      text: 'Static analysis of your Stim circuit: why a detector is non-deterministic, and a minimum-weight undetected logical error with the tick, qubits and source line of every fault.',
      platforms: ['desktop'],
      modes: ['research'],
    },
    {
      icon: 'agent',
      title: 'nuclei-mcp for your own agents',
      text: 'Run the same QEC statistics from Claude Code, Cursor or any MCP client. Every number carries a run ID and manifest.',
      platforms: ['desktop'],
      modes: ['research'],
    },
    {
      icon: 'analysis',
      title: 'Dirac answers in tables and code you can copy',
      text: 'Replies now render tables and quotes properly, keep formulas readable in plain Unicode, and every code block has a copy button.',
      modes: ['learn'],
    },
    {
      icon: 'security',
      title: 'The kernel now needs a per-launch token',
      text: 'Each launch generates a secret token, so web pages and other users on this machine cannot drive your kernel. Your own scripts and agents connect through a user-only runtime file.',
      platforms: ['desktop'],
    },
  ],
};
