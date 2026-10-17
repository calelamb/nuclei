import { describe, expect, it } from 'vitest';
import { CURATED_VIDEOS } from '../data/videos/curatedLibrary';
import { TRACKS } from '../data/lessons/tracks';
import type { Lesson } from '../data/lessons/types';

interface VideoRef {
  readonly source: string;
  readonly youtubeId: string;
  readonly title: string;
}

const YOUTUBE_ID = /^[\w-]{11}$/;
/** Known-bad IDs that must never ship (rickroll, dead links). */
const BANNED_IDS: readonly string[] = ['dQw4w9WgXcQ'];

function lessonVideos(lessons: readonly Lesson[]): VideoRef[] {
  return lessons.flatMap((lesson) =>
    lesson.contentBlocks.flatMap((block) =>
      block.type === 'video'
        ? [{ source: `lesson ${lesson.id}`, youtubeId: block.youtubeId, title: block.title }]
        : [],
    ),
  );
}

const ALL_VIDEOS: readonly VideoRef[] = [
  ...CURATED_VIDEOS.map((v) => ({ source: `library ${v.id}`, youtubeId: v.youtubeId, title: v.title })),
  ...lessonVideos(TRACKS.flatMap((t) => t.lessons)),
].filter((v) => v.youtubeId !== 'placeholder');

describe('video references (offline)', () => {
  it('uses well-formed YouTube ids', () => {
    const bad = ALL_VIDEOS.filter((v) => !YOUTUBE_ID.test(v.youtubeId));
    expect(bad).toEqual([]);
  });

  it('never ships a banned id', () => {
    const bad = ALL_VIDEOS.filter((v) => BANNED_IDS.includes(v.youtubeId));
    expect(bad).toEqual([]);
  });
});

/**
 * Network check, run on demand and by CI: NUCLEI_VIDEO_CHECK=1 npx vitest run src/ci/videoLinks.test.ts
 * Every id must resolve through YouTube oEmbed.
 */
describe.skipIf(!process.env.NUCLEI_VIDEO_CHECK)('video references (oEmbed)', () => {
  it('resolves every id', async () => {
    const ids = [...new Set(ALL_VIDEOS.map((v) => v.youtubeId))];
    const dead: string[] = [];
    for (const id of ids) {
      const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
      const res = await fetch(url);
      if (!res.ok) dead.push(`${id} (${res.status}) ${ALL_VIDEOS.filter((v) => v.youtubeId === id).map((v) => v.source).join(', ')}`);
    }
    expect(dead).toEqual([]);
  }, 120_000);
});
