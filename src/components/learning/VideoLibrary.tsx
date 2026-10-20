import { useState } from 'react';
import { CURATED_VIDEOS } from '../../data/videos/curatedLibrary';
import type { CuratedVideo } from '../../data/videos/curatedLibrary';
import { Play } from 'lucide-react';
import { Select } from '../ui';
import { CREATOR_FILTERS, CREATOR_LABEL, DIFFICULTY_FILTERS, filterVideos, type CreatorFilter, type DifficultyFilter } from './videoFilters';
import { VideoThumb } from './VideoThumb';
import { openExternal, buildYouTubeWatchUrl } from '../../lib/openExternal';
import './learnSidebar.css';

function VideoRow({ video, onPlay }: { video: CuratedVideo; onPlay: (video: CuratedVideo) => void }) {
  return (
    <button type="button" className="vrow" onClick={() => onPlay(video)}>
      <div className="vrow__thumb">
        <VideoThumb youtubeId={video.youtubeId} quality="mqdefault" className="vrow__img" width={96} height={54} />
        <span className="vrow__play"><Play size={16} fill="currentColor" aria-hidden="true" /></span>
        <span className="vrow__duration">{video.duration}</span>
      </div>
      <div className="vrow__info">
        <div className="vrow__title">{video.title}</div>
        <div className="vrow__meta">
          <span className="vrow__creator">{CREATOR_LABEL[video.creator]}</span>
          <span className="vrow__level">{video.difficulty}</span>
        </div>
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

  const filteredVideos = filterVideos(CURATED_VIDEOS, creatorFilter, difficultyFilter);

  return (
    <div className="vlib">
 <div className="vlib__filters">
        <Select size="sm" aria-label="Creator" value={creatorFilter} onChange={(e) => setCreatorFilter(e.target.value as CreatorFilter)}>
          {CREATOR_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.value === 'all' ? 'All creators' : f.label}</option>)}
        </Select>
        <Select size="sm" aria-label="Difficulty" value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value as DifficultyFilter)}>
          {DIFFICULTY_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
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
