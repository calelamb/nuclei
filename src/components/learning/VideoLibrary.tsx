import { useState } from 'react';
import { CURATED_VIDEOS } from '../../data/videos/curatedLibrary';
import type { CuratedVideo } from '../../data/videos/curatedLibrary';
import { Play } from 'lucide-react';
import { Badge, Select, Tabs, type TabOption } from '../ui';
import { CREATOR_FILTERS, CREATOR_LABEL, DIFFICULTY_FILTERS, filterVideos, type CreatorFilter, type DifficultyFilter } from './videoFilters';
import { VIDEO_LEVEL_TONE } from './levelTone';
import { VideoThumb } from './VideoThumb';
import { openExternal, buildYouTubeWatchUrl } from '../../lib/openExternal';
import './learnSidebar.css';

const RAIL_CREATOR_TABS: ReadonlyArray<TabOption<CreatorFilter>> = CREATOR_FILTERS.map((f) => ({
  value: f.value,
  label: f.value === '3blue1brown' ? '3B1B' : f.label,
  ariaLabel: f.value === '3blue1brown' ? CREATOR_LABEL['3blue1brown'] : undefined,
}));

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
          <Badge>{CREATOR_LABEL[video.creator]}</Badge>
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

  const filteredVideos = filterVideos(CURATED_VIDEOS, creatorFilter, difficultyFilter);

  return (
    <div className="vlib">
      <Tabs className="vlib__tabs" aria-label="Creator" value={creatorFilter} options={RAIL_CREATOR_TABS} onChange={setCreatorFilter} />

      <div className="vlib__levels">
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
