import type { CuratedVideo } from '../../data/videos/curatedLibrary';

export type CreatorFilter = 'all' | CuratedVideo['creator'];
export type DifficultyFilter = 'all' | CuratedVideo['difficulty'];

export const CREATOR_LABEL: Readonly<Record<CuratedVideo['creator'], string>> = {
  '3blue1brown': '3Blue1Brown',
  'ibm-technology': 'IBM',
  nvidia: 'NVIDIA',
  qiskit: 'Qiskit',
  other: 'Other',
};

/** The creator filter both video surfaces offer (the chooser shelf and the rail library). */
export const CREATOR_FILTERS: ReadonlyArray<{ value: CreatorFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: '3blue1brown', label: CREATOR_LABEL['3blue1brown'] },
  { value: 'ibm-technology', label: CREATOR_LABEL['ibm-technology'] },
  { value: 'nvidia', label: CREATOR_LABEL.nvidia },
  { value: 'qiskit', label: CREATOR_LABEL.qiskit },
];

export const DIFFICULTY_FILTERS: ReadonlyArray<{ value: DifficultyFilter; label: string }> = [
  { value: 'all', label: 'All levels' },
  { value: 'prerequisite', label: 'Prerequisite' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

export function filterVideos(
  videos: readonly CuratedVideo[],
  creator: CreatorFilter,
  difficulty: DifficultyFilter,
): CuratedVideo[] {
  return videos.filter(
    (v) => (creator === 'all' || v.creator === creator) && (difficulty === 'all' || v.difficulty === difficulty),
  );
}
