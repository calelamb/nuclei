import { Atom, Bot, Rocket, Sigma, Sparkles, type LucideIcon } from 'lucide-react';
import type { WhatsNewIcon } from './whatsNew';

/** Maps each highlight category to its Lucide icon. */
export const WHATS_NEW_ICONS: Record<WhatsNewIcon, LucideIcon> = {
  qsharp: Sigma,
  circuit: Atom,
  editor: Sparkles,
  dirac: Bot,
  hardware: Rocket,
};
