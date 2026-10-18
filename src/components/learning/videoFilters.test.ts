import { describe, expect, it } from 'vitest';
import { CURATED_VIDEOS } from '../../data/videos/curatedLibrary';
import { CREATOR_FILTERS, DIFFICULTY_FILTERS, filterVideos } from './videoFilters';

describe('videoFilters', () => {
  it('returns everything for all/all', () => {
    expect(filterVideos(CURATED_VIDEOS, 'all', 'all')).toHaveLength(CURATED_VIDEOS.length);
  });

  it('combines creator and difficulty', () => {
    const nvidia = filterVideos(CURATED_VIDEOS, 'nvidia', 'all');
    expect(nvidia.every((v) => v.creator === 'nvidia')).toBe(true);
    const narrowed = filterVideos(CURATED_VIDEOS, 'nvidia', nvidia[0].difficulty);
    expect(narrowed.every((v) => v.creator === 'nvidia' && v.difficulty === nvidia[0].difficulty)).toBe(true);
  });

  it('offers every creator and level that exists in the library', () => {
    const creators = new Set(CREATOR_FILTERS.map((f) => f.value));
    const levels = new Set(DIFFICULTY_FILTERS.map((f) => f.value));
    for (const v of CURATED_VIDEOS) {
      if (v.creator !== 'other') expect(creators.has(v.creator)).toBe(true);
      expect(levels.has(v.difficulty)).toBe(true);
    }
  });
});
