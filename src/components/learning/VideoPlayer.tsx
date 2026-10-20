import { Play } from 'lucide-react';
import { VideoThumb } from './VideoThumb';
import { openExternal, buildYouTubeWatchUrl } from '../../lib/openExternal';
import './lessonBlocks.css';

type VideoSource = '3blue1brown' | 'ibm-technology' | 'nvidia' | 'qiskit' | 'other';

interface VideoChapter {
  time: number;
  label: string;
}

interface VideoPlayerProps {
  youtubeId: string;
  title: string;
  creator: string;
  startTime?: number;
  endTime?: number;
  source?: VideoSource;
  chapters?: VideoChapter[];
}

const SOURCE_LABEL: Record<VideoSource, string> = {
  '3blue1brown': '3B1B',
  'ibm-technology': 'IBM',
  nvidia: 'NVIDIA',
  qiskit: 'Qiskit',
  other: 'Video',
};

function formatChapterTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function VideoMeta({ title, creator, source, children }: { title: string; creator: string; source?: VideoSource; children?: React.ReactNode }) {
  return (
    <div className="video__meta">
      <div className="video__title-row">
        <div className="video__title">{title}</div>
        {source && <span className="video__source">{SOURCE_LABEL[source]}</span>}
      </div>
      <div className="video__creator">{creator}</div>
      {children}
    </div>
  );
}

export function VideoPlayer({ youtubeId, title, creator, startTime, source, chapters }: VideoPlayerProps) {
  if (youtubeId === 'placeholder') {
    return (
      <div className="video">
        <div className="video__poster video__poster--soon">
          <div className="video__veil video__veil--bare">
            <span className="video__disc video__disc--soon"><Play size={20} aria-hidden="true" /></span>
            <span className="video__soon">Video coming soon</span>
          </div>
        </div>
        <VideoMeta title={title} creator={creator} />
      </div>
    );
  }

  const handlePlay = (seconds?: number) => {
    void openExternal(buildYouTubeWatchUrl(youtubeId, seconds ?? startTime));
  };

  return (
    <div className="video">
      <button type="button" className="video__poster" onClick={() => handlePlay()} aria-label={`Play "${title}" on YouTube`}>
        <VideoThumb youtubeId={youtubeId} quality="hqdefault" className="video__img" />
        <span className="video__veil">
          <span className="video__disc"><Play size={20} fill="currentColor" aria-hidden="true" /></span>
        </span>
        <span className="video__badge">Opens in browser</span>
      </button>
      <VideoMeta title={title} creator={creator} source={source}>
        {chapters && chapters.length > 0 && (
          <div className="video__chapters">
            <div className="video__chapters-label">Chapters</div>
            {chapters.map((chapter, i) => (
              <button key={i} type="button" className="video__chapter" onClick={() => handlePlay(chapter.time)}>
                <span className="video__chapter-time">{formatChapterTime(chapter.time)}</span>
                <span className="video__chapter-label">{chapter.label}</span>
              </button>
            ))}
          </div>
        )}
      </VideoMeta>
    </div>
  );
}
