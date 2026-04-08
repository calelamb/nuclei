import { useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useLearnStore } from '../../stores/learnStore';
import { TRACKS } from '../../data/lessons/tracks';
import { CURATED_VIDEOS } from '../../data/videos/curatedLibrary';
import { BookOpen, ChevronRight, CheckCircle, Lock, Play, X } from 'lucide-react';

export function TrackSelector() {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const setCurrentLesson = useLearnStore((s) => s.setCurrentLesson);
  const completedLessons = useLearnStore((s) => s.completedLessons);
  const lessonProgress = useLearnStore((s) => s.lessonProgress);
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      padding: '32px 32px 48px',
      background: colors.bg,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `linear-gradient(135deg, ${colors.accent}20, ${colors.dirac}20)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BookOpen size={20} color={colors.accent} />
          </div>
          <div>
            <h1 style={{
              color: colors.text,
              fontSize: 24,
              fontWeight: 700,
              fontFamily: "'Geist Sans', sans-serif",
              margin: 0,
            }}>
              Learn Quantum Computing
            </h1>
            <p style={{
              color: colors.textMuted,
              fontSize: 14,
              fontFamily: "'Geist Sans', sans-serif",
              margin: '2px 0 0',
            }}>
              Code-first lessons with interactive demos. Watch, play, prove.
            </p>
          </div>
        </div>
      </div>

      {/* Track cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {TRACKS.map((track) => {
          const lessonCount = track.lessons.length;
          const completed = track.lessons.filter((l) => completedLessons.includes(l.id)).length;
          const hasLessons = lessonCount > 0;
          const isStarted = track.lessons.some((l) => lessonProgress[l.id]);
          const progress = lessonCount > 0 ? completed / lessonCount : 0;

          // Find the first incomplete lesson to resume
          const resumeLesson = track.lessons.find((l) => !completedLessons.includes(l.id)) ?? track.lessons[0];

          return (
            <button
              key={track.id}
              onClick={() => {
                if (hasLessons && resumeLesson) {
                  setCurrentLesson(track.id, resumeLesson.id);
                }
              }}
              disabled={!hasLessons}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: 20,
                background: colors.bgElevated,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                cursor: hasLessons ? 'pointer' : 'default',
                textAlign: 'left',
                boxShadow: shadow.sm,
                transition: 'all 200ms ease',
                opacity: hasLessons ? 1 : 0.5,
              }}
              onMouseEnter={(e) => {
                if (hasLessons) {
                  e.currentTarget.style.borderColor = colors.accent;
                  e.currentTarget.style.boxShadow = shadow.glow;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.boxShadow = shadow.sm;
              }}
            >
              {/* Track number */}
              <div style={{
                width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                background: hasLessons
                  ? `linear-gradient(135deg, ${colors.accent}25, ${colors.accent}10)`
                  : colors.bgPanel,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: hasLessons ? colors.accent : colors.textDim,
                fontSize: 18, fontWeight: 700,
                fontFamily: "'Geist Sans', sans-serif",
              }}>
                {completed === lessonCount && lessonCount > 0
                  ? <CheckCircle size={22} />
                  : !hasLessons ? <Lock size={18} />
                  : track.id.split('-')[1]
                }
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: colors.text,
                  fontSize: 16,
                  fontWeight: 600,
                  fontFamily: "'Geist Sans', sans-serif",
                  marginBottom: 4,
                }}>
                  {track.title}
                </div>
                <div style={{
                  color: colors.textMuted,
                  fontSize: 13,
                  fontFamily: "'Geist Sans', sans-serif",
                  lineHeight: 1.4,
                  marginBottom: 8,
                }}>
                  {track.description}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    color: colors.textDim, fontSize: 11,
                    fontFamily: "'Geist Sans', sans-serif",
                  }}>
                    {hasLessons ? `${lessonCount} lessons` : 'Coming soon'}
                  </span>
                  <span style={{
                    padding: '1px 6px', borderRadius: 3,
                    background: `${colors.accent}12`,
                    color: colors.accent, fontSize: 10,
                    fontWeight: 500, fontFamily: "'Geist Sans', sans-serif",
                  }}>
                    {track.difficulty}
                  </span>
                  {isStarted && hasLessons && (
                    <>
                      <div style={{
                        flex: 1, maxWidth: 120, height: 4,
                        background: colors.bgPanel, borderRadius: 2,
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: `${progress * 100}%`,
                          height: '100%',
                          background: colors.accent,
                          borderRadius: 2,
                          transition: 'width 300ms ease',
                        }} />
                      </div>
                      <span style={{
                        color: colors.textDim, fontSize: 10,
                        fontFamily: "'Geist Sans', sans-serif",
                      }}>
                        {completed}/{lessonCount}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Arrow */}
              {hasLessons && (
                <ChevronRight size={20} color={colors.textDim} style={{ flexShrink: 0 }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Curated Videos */}
      <div style={{ marginTop: 40 }}>
        <h2 style={{
          color: colors.text, fontSize: 18, fontWeight: 600,
          fontFamily: "'Geist Sans', sans-serif", margin: '0 0 16px',
        }}>
          Curated Video Lessons
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 12,
        }}>
          {CURATED_VIDEOS.slice(0, 8).map((video) => (
            <button
              key={video.id}
              onClick={() => setPlayingVideo(video.youtubeId)}
              style={{
                display: 'flex', gap: 10, padding: 10,
                background: colors.bgElevated, border: `1px solid ${colors.border}`,
                borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                transition: 'border-color 150ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = colors.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = colors.border; }}
            >
              <div style={{
                width: 80, height: 50, borderRadius: 4, overflow: 'hidden', flexShrink: 0,
                background: colors.bgPanel, position: 'relative',
              }}>
                <img
                  src={`https://img.youtube.com/vi/${video.youtubeId}/mqdefault.jpg`}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(0,0,0,0.3)',
                }}>
                  <Play size={16} color="#fff" fill="#fff" />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: colors.text, fontSize: 12, fontWeight: 500,
                  fontFamily: "'Geist Sans', sans-serif",
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {video.title}
                </div>
                <div style={{
                  color: colors.textDim, fontSize: 10,
                  fontFamily: "'Geist Sans', sans-serif", marginTop: 2,
                }}>
                  {video.creator === '3blue1brown' ? '3Blue1Brown' : video.creator === 'ibm-technology' ? 'IBM' : video.creator === 'nvidia' ? 'NVIDIA' : video.creator === 'qiskit' ? 'Qiskit' : video.creator}
                  {' '}&middot;{' '}{video.duration}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Video modal */}
      {playingVideo && (
        <div
          onClick={() => setPlayingVideo(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '80%', maxWidth: 800, position: 'relative' }}
          >
            <button
              onClick={() => setPlayingVideo(null)}
              style={{
                position: 'absolute', top: -36, right: 0,
                background: 'transparent', border: 'none',
                color: '#fff', cursor: 'pointer',
              }}
            >
              <X size={20} />
            </button>
            <div style={{ paddingBottom: '56.25%', position: 'relative' }}>
              <iframe
                src={`https://www.youtube.com/embed/${playingVideo}?autoplay=1`}
                title="Video"
                style={{
                  position: 'absolute', top: 0, left: 0,
                  width: '100%', height: '100%', border: 'none',
                  borderRadius: 8,
                }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
