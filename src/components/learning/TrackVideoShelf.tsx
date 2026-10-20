import { useState } from 'react';
import { Play } from 'lucide-react';
import { VideoThumb } from './VideoThumb';
import { CURATED_VIDEOS, type CuratedVideo } from '../../data/videos/curatedLibrary';
import { openExternal, buildYouTubeWatchUrl } from '../../lib/openExternal';
import { Badge, SegmentedControl, Select, type SegmentedOption } from '../ui';
import { CREATOR_FILTERS, CREATOR_LABEL, DIFFICULTY_FILTERS, filterVideos, type CreatorFilter, type DifficultyFilter } from './videoFilters';
import { VIDEO_LEVEL_TONE } from './levelTone';
import './trackSelector.css';

const FILTERS: ReadonlyArray<SegmentedOption<CreatorFilter>> = CREATOR_FILTERS;

function VideoCard({ video }: { video: CuratedVideo }) {
  return (
    <button type="button" className="video-card" onClick={() => void openExternal(buildYouTubeWatchUrl(video.youtubeId))}>
      <div className="video-card__thumb">
        <VideoThumb youtubeId={video.youtubeId} quality="hqdefault" className="video-card__img" />
        <div className="video-card__play">
          <span className="video-card__play-disc"><Play size={20} fill="currentColor" aria-hidden="true" /></span>
        </div>
        <span className="video-card__duration">{video.duration}</span>
      </div>
      <div className="video-card__info">
        <div className="video-card__name">{video.title}</div>
        <div className="video-card__tags">
          <Badge>{CREATOR_LABEL[video.creator]}</Badge>
          <Badge tone={VIDEO_LEVEL_TONE[video.difficulty]} style={{ textTransform: 'capitalize' }}>{video.difficulty}</Badge>
        </div>
        <div className="video-card__desc">{video.description}</div>
      </div>
    </button>
  );
}

/** Curated YouTube library in the Learn chooser, filterable by creator and level (same filters as the rail). */
export function TrackVideoShelf() {
  const [creator, setCreator] = useState<CreatorFilter>('all');
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('all');
  const videos = filterVideos(CURATED_VIDEOS, creator, difficulty);

  return (
    <section className="shelf" aria-label="Video library">
      <div className="shelf__head">
        <p className="shelf__sub">Curated from 3Blue1Brown, IBM, NVIDIA, and Qiskit</p>
        <span className="shelf__count">{videos.length} of {CURATED_VIDEOS.length} videos</span>
      </div>
      <div className="shelf__filter">
        <SegmentedControl aria-label="Filter videos by creator" value={creator} options={FILTERS} onChange={setCreator} />
        <Select size="sm" aria-label="Filter videos by level" value={difficulty} onChange={(e) => setDifficulty(e.target.value as DifficultyFilter)}>
          {DIFFICULTY_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </Select>
      </div>
      <div className="shelf__grid">
        {videos.map((video) => <VideoCard key={video.id} video={video} />)}
      </div>
    </section>
  );
}
