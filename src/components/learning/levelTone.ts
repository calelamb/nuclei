import type { BadgeTone } from '../ui';
import type { Lesson } from '../../data/lessons/types';
import type { CuratedVideo } from '../../data/videos/curatedLibrary';

/** Badge tones for lesson and video levels, so every level pill meets AA in both themes. */
export const LESSON_LEVEL_TONE: Readonly<Record<Lesson['difficulty'], BadgeTone>> = {
  'absolute-beginner': 'accent',
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'danger',
};

export const VIDEO_LEVEL_TONE: Readonly<Record<CuratedVideo['difficulty'], BadgeTone>> = {
  prerequisite: 'neutral',
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'danger',
};

/** Tone for any free-form level string ("advanced", "Beginner"): one mapping for capstones and lessons alike. */
export function levelTone(level: string): BadgeTone {
  const key = level.trim().toLowerCase().replace(/\s+/g, '-');
  if (key === 'absolute-beginner') return LESSON_LEVEL_TONE['absolute-beginner'];
  if (key === 'beginner' || key === 'intermediate' || key === 'advanced') return LESSON_LEVEL_TONE[key];
  return 'neutral';
}
