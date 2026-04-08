import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';

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

const SOURCE_BADGES: Record<VideoSource, { label: string; color: string }> = {
  '3blue1brown': { label: '3B1B', color: '#3b82f6' },
  'ibm-technology': { label: 'IBM', color: '#2563eb' },
  'nvidia': { label: 'NVIDIA', color: '#22c55e' },
  'qiskit': { label: 'Qiskit', color: '#8b5cf6' },
  'other': { label: 'Video', color: '#6b7280' },
};

function formatChapterTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VideoPlayer({ youtubeId, title, creator, startTime, endTime, source, chapters }: VideoPlayerProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const [chapterStart, setChapterStart] = useState<number | undefined>(startTime);

  if (youtubeId === 'placeholder') {
    return (
      <div style={{
        maxWidth: 720,
        margin: '16px auto',
        borderRadius: 12,
        overflow: 'hidden',
        background: colors.bgElevated,
        border: `1px solid ${colors.border}`,
        boxShadow: shadow.md,
      }}>
        <div style={{
          width: '100%',
          paddingBottom: '56.25%',
          position: 'relative',
          background: `linear-gradient(135deg, ${colors.bgPanel}, ${colors.bgElevated})`,
        }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}>
            <div style={{
              width: 64, height: 64,
              borderRadius: '50%',
              background: `${colors.accent}20`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <span style={{ color: colors.textMuted, fontSize: 14, fontFamily: "'Geist Sans', sans-serif" }}>
              Video coming soon
            </span>
          </div>
        </div>
        <div style={{ padding: '10px 16px' }}>
          <div style={{ color: colors.text, fontSize: 14, fontWeight: 500, fontFamily: "'Geist Sans', sans-serif" }}>{title}</div>
          <div style={{ color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif", marginTop: 2 }}>{creator}</div>
        </div>
      </div>
    );
  }

  const effectiveStart = chapterStart ?? startTime;
  let src = `https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&rel=0`;
  if (effectiveStart) src += `&start=${effectiveStart}`;
  if (endTime) src += `&end=${endTime}`;

  return (
    <div style={{
      maxWidth: 720,
      margin: '16px auto',
      borderRadius: 12,
      overflow: 'hidden',
      background: colors.bgPanel,
      border: `1px solid ${colors.border}`,
      boxShadow: shadow.md,
    }}>
      <div style={{
        width: '100%',
        paddingBottom: '56.25%',
        position: 'relative',
      }}>
        <iframe
          src={src}
          title={title}
          style={{
            position: 'absolute',
            top: 0, left: 0,
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <div style={{ padding: '10px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ color: colors.text, fontSize: 14, fontWeight: 500, fontFamily: "'Geist Sans', sans-serif" }}>{title}</div>
          {source && (
            <span style={{
              fontSize: 9,
              fontFamily: "'Geist Sans', sans-serif",
              fontWeight: 600,
              color: SOURCE_BADGES[source].color,
              background: `${SOURCE_BADGES[source].color}18`,
              padding: '2px 6px',
              borderRadius: 3,
              flexShrink: 0,
            }}>
              {SOURCE_BADGES[source].label}
            </span>
          )}
        </div>
        <div style={{ color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif", marginTop: 2 }}>{creator}</div>

        {chapters && chapters.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{
              color: colors.textMuted,
              fontSize: 10,
              fontWeight: 600,
              fontFamily: "'Geist Sans', sans-serif",
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 2,
            }}>
              Chapters
            </div>
            {chapters.map((chapter, i) => (
              <button
                key={i}
                onClick={() => setChapterStart(chapter.time)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '3px 6px',
                  background: chapterStart === chapter.time ? `${colors.accent}12` : 'transparent',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  if (chapterStart !== chapter.time) e.currentTarget.style.background = colors.bgElevated;
                }}
                onMouseLeave={(e) => {
                  if (chapterStart !== chapter.time) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{
                  color: colors.accent,
                  fontSize: 10,
                  fontFamily: "'Geist Mono', monospace",
                  fontWeight: 500,
                  minWidth: 32,
                }}>
                  {formatChapterTime(chapter.time)}
                </span>
                <span style={{
                  color: colors.text,
                  fontSize: 11,
                  fontFamily: "'Geist Sans', sans-serif",
                }}>
                  {chapter.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
