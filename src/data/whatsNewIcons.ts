import { LineChart, Plug, SearchCode, ShieldCheck, Sigma, type LucideIcon } from 'lucide-react';
import type { WhatsNewIcon } from './whatsNew';

/** Maps each highlight category to an icon that says what the item is about. */
export const WHATS_NEW_ICONS: Record<WhatsNewIcon, LucideIcon> = {
  security: ShieldCheck,
  chart: LineChart,
  statistics: Sigma,
  analysis: SearchCode,
  agent: Plug,
};
