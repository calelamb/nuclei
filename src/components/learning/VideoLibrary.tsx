import { useState } from 'react';
import { CURATED_VIDEOS } from '../../data/videos/curatedLibrary';
import type { CuratedVideo } from '../../data/videos/curatedLibrary';
import { Play } from 'lucide-react';
import { Badge } from '../ui';
import { VIDEO_LEVEL_TONE } from './levelTone';
import { VideoThumb } from './VideoThumb';
import { openExternal, buildYouTubeWatchUrl } from '../../lib/openExternal';
import './learnSidebar.css';

type CreatorFilter = 'all' | CuratedVideo['creator'];
type DifficultyFilter = 'all' | CuratedVideo['difficulty'];

const CREATOR_TABS: { key: CreatorFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: '3blue1brown', label: '3B1B' },
  { key: 'ibm-technology', label: 'IBM' },
  { key: 'nvidia', label: 'NVIDIA' },
  { key: 'qiskit', label: 'Qiskit' },
];

const DIFFICULTY_PILLS: { key: DifficultyFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'prerequisite', label: 'Prerequisite' },
  { key: 'beginner', label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
];

const CREATOR_LABELS: Record<CuratedVideo['creator'], string> = {
  '3blue1brown': '3B1B',
  'ibm-technology': 'IBM',
  nvidia: 'NVIDIA',
  qiskit: 'Qiskit',
  other: 'Other',
};

function VideoRow({ video, onPlay }: { video: CuratedVideo; onPlay: (video: CuratedVideo) => void }) {
  return (
    <button type="button" className="vrow" onClick={() => onPlay(video)}>
      <div className="vrow__thumb">
        <VideoThumb youtubeId={video.youtubeId} quality="mqdefault" className="vrow__img" width={120} height={68} />
        <span className="vrow__play"><Play size={20} fill="currentColor" aria-hidden="true" /></span>
        <span className="vrow__duration">{video.duration}</span>
      </div>
      <div className="vrow__info">
        <div className="vrow__title">{video.title}</div>
        <div className="vrow__tags">
          <span className="vrow__creator">{CREATOR_LABELS[video.creator]}</span>
          <Badge tone={VIDEO_LEVEL_TONE[video.difficulty]} style={{ textTransform: 'capitalize' }}>{video.difficulty}</Badge>
        </div>
        <div className="vrow__desc">{video.description}</div>
      </div>
    </button>
  );
}

export function VideoLibrary() {
  const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all');

  const handlePlay = (video: CuratedVideo) => {
    void openExternal(buildYouTubeWatchUrl(video.youtubeId));
  };

  const filteredVideos = CURATED_VIDEOS.filter((v) => {
    if (creatorFilter !== 'all' && v.creator !== creatorFilter) return false;
    if (difficultyFilter !== 'all' && v.difficulty !== difficultyFilter) return false;
    return true;
  });

  return (
    <div className="vlib">
      <div className="vlib__tabs" role="tablist" aria-label="Creator">
        {CREATOR_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={creatorFilter === tab.key}
            aria-label={tab.key === '3blue1brown' ? '3Blue1Brown' : undefined}
            className="vlib__tab"
            onClick={() => setCreatorFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="vlib__levels" role="group" aria-label="Difficulty">
        {DIFFICULTY_PILLS.map((pill) => (
          <button
            key={pill.key}
            type="button"
            className="gloss__cat"
            aria-pressed={difficultyFilter === pill.key}
            onClick={() => setDifficultyFilter(pill.key)}
          >
            {pill.label}
          </button>
        ))}
      </div>

      <div className="vlib__count" aria-live="polite">{filteredVideos.length} video{filteredVideos.length !== 1 ? 's' : ''}</div>

      <div className="vlib__list">
        {filteredVideos.length === 0 ? (
          <div className="vlib__empty">No videos match the current filters.</div>
        ) : (
          filteredVideos.map((video) => <VideoRow key={video.id} video={video} onPlay={handlePlay} />)
        )}
      </div>
    </div>
  );
}
