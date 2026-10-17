import type { BadgeTone } from '../ui';
import type { ChallengeDifficulty } from '../../types/challenge';

/** Badge tone for a problem's difficulty, so the pill meets AA in both themes. */
export const DIFFICULTY_TONE: Readonly<Record<ChallengeDifficulty, BadgeTone>> = {
  easy: 'success',
  medium: 'warning',
  hard: 'danger',
};
