import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { CURATED_VIDEOS } from '../../data/videos/curatedLibrary';
import type { CuratedVideo } from '../../data/videos/curatedLibrary';
import { Play } from 'lucide-react';
import { openExternal, buildYouTubeWatchUrl } from '../../lib/openExternal';

type CreatorFilter = 'all' | CuratedVideo['creator'];
type DifficultyFilter = 'all' | CuratedVideo['difficulty'];

const CREATOR_TABS: { key: CreatorFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: '3blue1brown', label: '3Blue1Brown' },
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

const CREATOR_COLORS: Record<CuratedVideo['creator'], string> = {
  '3blue1brown': '#3b82f6',
  'ibm-technology': '#2563eb',
  'nvidia': '#22c55e',
  'qiskit': '#8b5cf6',
  'other': '#6b7280',
};

const CREATOR_LABELS: Record<CuratedVideo['creator'], string> = {
  '3blue1brown': '3B1B',
  'ibm-technology': 'IBM',
  'nvidia': 'NVIDIA',
  'qiskit': 'Qiskit',
  'other': 'Other',
};

const DIFFICULTY_COLORS: Record<CuratedVideo['difficulty'], string> = {
  prerequisite: '#6b7280',
  beginner: '#22c55e',
  intermediate: '#f59e0b',
  advanced: '#ef4444',
};

function VideoCard({
  video,
  onPlay,
}: {
  video: CuratedVideo;
  onPlay: (video: CuratedVideo) => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={() => onPlay(video)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        gap: 10,
        width: '100%',
        padding: 8,
        background: hovered ? colors.bgElevated : 'transparent',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 150ms ease',
      }}
    >
      {/* Thumbnail */}
      <div style={{
        width: 120,
        height: 68,
        borderRadius: 4,
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
        background: colors.bgPanel,
      }}>
        <img
          src={`https://img.youtube.com/vi/${video.youtubeId}/mqdefault.jpg`}
          alt={video.title}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
          loading="lazy"
          width={120}
          height={68}
        />
        {hovered && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Play size={20} color="#fff" fill="#fff" />
          </div>
        )}
        {/* Duration badge */}
        <span style={{
          position: 'absolute',
          bottom: 3,
          right: 3,
          background: 'rgba(0,0,0,0.75)',
          color: '#fff',
          fontSize: 9,
          fontFamily: "'Geist Mono', monospace",
          padding: '1px 4px',
          borderRadius: 2,
        }}>
          {video.duration}
        </span>
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{
          color: colors.text,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "'Geist Sans', sans-serif",
          lineHeight: 1.3,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {video.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 9,
            fontFamily: "'Geist Sans', sans-serif",
            fontWeight: 600,
            color: CREATOR_COLORS[video.creator],
            background: `${CREATOR_COLORS[video.creator]}18`,
            padding: '1px 5px',
            borderRadius: 3,
          }}>
            {CREATOR_LABELS[video.creator]}
          </span>
          <span style={{
            fontSize: 9,
            fontFamily: "'Geist Sans', sans-serif",
            fontWeight: 500,
            color: DIFFICULTY_COLORS[video.difficulty],
            textTransform: 'capitalize',
          }}>
            {video.difficulty}
          </span>
        </div>
        <div style={{
          color: colors.textDim,
          fontSize: 10,
          fontFamily: "'Geist Sans', sans-serif",
          lineHeight: 1.3,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {video.description}
        </div>
      </div>
    </button>
  );
}

export function VideoLibrary() {
  const colors = useThemeStore((s) => s.colors);
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
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Creator tabs */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
        padding: '0 8px',
      }}>
        {CREATOR_TABS.map((tab) => {
          const isActive = creatorFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setCreatorFilter(tab.key)}
              style={{
                padding: '6px 10px',
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
                color: isActive ? colors.accent : colors.textDim,
                fontSize: 10,
                fontWeight: 600,
                fontFamily: "'Geist Sans', sans-serif",
                cursor: 'pointer',
                transition: 'color 150ms, border-color 150ms',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Difficulty pills */}
      <div style={{
        display: 'flex',
        gap: 4,
        padding: '8px 8px 6px',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        {DIFFICULTY_PILLS.map((pill) => {
          const isActive = difficultyFilter === pill.key;
          const pillColor = pill.key === 'all' ? colors.accent : DIFFICULTY_COLORS[pill.key as CuratedVideo['difficulty']];
          return (
            <button
              key={pill.key}
              onClick={() => setDifficultyFilter(pill.key)}
              style={{
                padding: '2px 8px',
                background: isActive ? `${pillColor}20` : 'transparent',
                border: `1px solid ${isActive ? pillColor : colors.border}`,
                borderRadius: 10,
                color: isActive ? pillColor : colors.textDim,
                fontSize: 10,
                fontFamily: "'Geist Sans', sans-serif",
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 150ms ease',
              }}
            >
              {pill.label}
            </button>
          );
        })}
      </div>

      {/* Video count */}
      <div style={{
        padding: '0 12px 6px',
        color: colors.textDim,
        fontSize: 10,
        fontFamily: "'Geist Sans', sans-serif",
        flexShrink: 0,
      }}>
        {filteredVideos.length} video{filteredVideos.length !== 1 ? 's' : ''}
      </div>

      {/* Video list */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '0 4px 8px',
      }}>
        {filteredVideos.length === 0 ? (
          <div style={{
            padding: 24,
            textAlign: 'center',
            color: colors.textDim,
            fontSize: 12,
            fontFamily: "'Geist Sans', sans-serif",
          }}>
            No videos match the current filters.
          </div>
        ) : (
          filteredVideos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              onPlay={handlePlay}
            />
          ))
        )}
      </div>
    </div>
  );
}
