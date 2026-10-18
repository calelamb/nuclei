import { useState } from 'react';
import { Play } from 'lucide-react';
import { VideoThumb } from './VideoThumb';
import { CURATED_VIDEOS, type CuratedVideo } from '../../data/videos/curatedLibrary';
import { openExternal, buildYouTubeWatchUrl } from '../../lib/openExternal';
import { Badge, SegmentedControl, type SegmentedOption } from '../ui';
import { VIDEO_LEVEL_TONE } from './levelTone';
import './trackSelector.css';

type CreatorFilter = 'all' | CuratedVideo['creator'];

const CREATOR_LABEL: Record<CuratedVideo['creator'], string> = {
  '3blue1brown': '3Blue1Brown',
  'ibm-technology': 'IBM',
  nvidia: 'NVIDIA',
  qiskit: 'Qiskit',
  other: 'Other',
};

const FILTERS: ReadonlyArray<SegmentedOption<CreatorFilter>> = [
  { value: 'all', label: 'All' },
  { value: '3blue1brown', label: CREATOR_LABEL['3blue1brown'] },
  { value: 'ibm-technology', label: CREATOR_LABEL['ibm-technology'] },
  { value: 'nvidia', label: CREATOR_LABEL.nvidia },
  { value: 'qiskit', label: CREATOR_LABEL.qiskit },
];

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

/** Curated YouTube library under the track list, filterable by creator. */
export function TrackVideoShelf() {
  const [creator, setCreator] = useState<CreatorFilter>('all');
  const videos = creator === 'all' ? CURATED_VIDEOS : CURATED_VIDEOS.filter((v) => v.creator === creator);

  return (
    <section className="shelf" aria-label="Video library">
      <div className="shelf__head">
        <div>
          <h2 className="shelf__title">Video library</h2>
          <p className="shelf__sub">Curated from 3Blue1Brown, IBM, NVIDIA, and Qiskit</p>
        </div>
        <span className="shelf__count">{videos.length} of {CURATED_VIDEOS.length} videos</span>
      </div>
      <div className="shelf__filter">
        <SegmentedControl aria-label="Filter videos by creator" value={creator} options={FILTERS} onChange={setCreator} />
      </div>
      <div className="shelf__grid">
        {videos.map((video) => <VideoCard key={video.id} video={video} />)}
      </div>
    </section>
  );
}
