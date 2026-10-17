import { BookOpen, Play, Code, HelpCircle, MessageSquare, Layers, type LucideIcon } from 'lucide-react';
import type { ContentBlock } from '../../data/lessons/types';

export interface BlockMeta {
  icon: LucideIcon;
  label: string;
}

const BLOCK_META: Record<ContentBlock['type'], BlockMeta> = {
  text: { icon: BookOpen, label: 'Read' },
  video: { icon: Play, label: 'Watch' },
  demo: { icon: Code, label: 'Demo' },
  exercise: { icon: HelpCircle, label: 'Exercise' },
  quiz: { icon: MessageSquare, label: 'Quiz' },
  'concept-card': { icon: Layers, label: 'Concept' },
  'interactive-bloch': { icon: Layers, label: 'Bloch sphere' },
};

const HEADING = /^#{1,4}\s+(.+?)\s*#*\s*$/m;

function stripInlineMarkdown(text: string): string {
  return text.replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
}

const MAX_PHRASE = 40;

/** First sentence of a description, cut to a short outline-friendly phrase. */
function shortPhrase(text: string): string {
  const first = stripInlineMarkdown(text).split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]+$/, '').trim() ?? '';
  return first.length > MAX_PHRASE ? `${first.slice(0, MAX_PHRASE - 1).trimEnd()}…` : first;
}

export function blockMeta(block: ContentBlock): BlockMeta {
  return BLOCK_META[block.type] ?? BLOCK_META.text;
}

/** What the lesson outline shows for a block: its own title when it has one, otherwise its kind. */
export function blockOutlineLabel(block: ContentBlock): string {
  switch (block.type) {
    case 'text': {
      const heading = HEADING.exec(block.markdown)?.[1];
      return heading ? stripInlineMarkdown(heading) : BLOCK_META.text.label;
    }
    case 'video':
    case 'concept-card':
    case 'exercise':
      return block.title.trim() || BLOCK_META[block.type].label;
    case 'demo':
      return shortPhrase(block.description) || BLOCK_META.demo.label;
    case 'interactive-bloch':
      return block.challenge ? 'Bloch sphere challenge' : 'Try the Bloch sphere';
    default:
      return blockMeta(block).label;
  }
}
