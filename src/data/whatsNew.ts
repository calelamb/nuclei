/**
 * Release notes for the post-update "What's New" release moment.
 *
 * Data-driven on purpose: when shipping a new release, update WHATS_NEW with
 * the new version + highlights and the modal handles the rest (shown once
 * per version, desktop only, silent on fresh installs).
 */

export type WhatsNewIcon = 'security' | 'chart' | 'statistics' | 'analysis' | 'agent';

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
  version: '0.14.0',
  title: 'QEC statistics you can cite',
  tagline: 'Drop a sinter CSV, get sinter-grade numbers with their uncertainty, and a kernel that no longer trusts every local process.',
  highlights: [
    {
      icon: 'chart',
      title: 'Drop a sinter CSV to plot it',
      text: 'Drop a sinter stats CSV on the QEC Workbench for logical error rate vs p per distance. Read locally; nothing is uploaded.',
    },
    {
      icon: 'statistics',
      title: 'Sinter-grade statistics',
      text: 'Likelihood-ratio intervals, per-round rates, and a Λ estimate with a 95% interval and plain-language warnings when it is not defensible.',
    },
    {
      icon: 'analysis',
      title: 'Explain why this circuit fails',
      text: 'Static analysis of your Stim circuit: why a detector is non-deterministic, and a minimum-weight undetected logical error with the tick, qubits and source line of every fault.',
    },
    {
      icon: 'agent',
      title: 'nuclei-mcp for your own agents',
      text: 'Run the same QEC statistics from Claude Code, Cursor or any MCP client. Every number carries a run ID and manifest.',
    },
    {
      icon: 'security',
      title: 'The kernel now needs a per-launch token',
      text: 'Each launch generates a secret token, so web pages and other users on this machine cannot drive your kernel. Your own scripts and agents connect through a user-only runtime file.',
    },
  ],
};
