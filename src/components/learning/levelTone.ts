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
