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

  const [videoCreatorFilter, setVideoCreatorFilter] = useState<string>('all');
  const filteredVideos = videoCreatorFilter === 'all'
    ? CURATED_VIDEOS
    : CURATED_VIDEOS.filter((v) => v.creator === videoCreatorFilter);

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
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

      {/* ── Video Library ── */}
      <div style={{ marginTop: 48 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{
              color: colors.text, fontSize: 20, fontWeight: 700,
              fontFamily: "'Geist Sans', sans-serif", margin: 0,
            }}>
              Video Library
            </h2>
            <p style={{
              color: colors.textMuted, fontSize: 13,
              fontFamily: "'Geist Sans', sans-serif", margin: '4px 0 0',
            }}>
              Curated from 3Blue1Brown, IBM, NVIDIA, and Qiskit
            </p>
          </div>
          <span style={{ color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
            {CURATED_VIDEOS.length} videos
          </span>
        </div>

        {/* Creator filter tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { key: 'all', label: 'All', color: colors.accent },
            { key: '3blue1brown', label: '3Blue1Brown', color: '#3b82f6' },
            { key: 'ibm-technology', label: 'IBM Technology', color: '#2563eb' },
            { key: 'nvidia', label: 'NVIDIA', color: '#22c55e' },
            { key: 'qiskit', label: 'Qiskit', color: '#8b5cf6' },
          ].map((tab) => {
            const active = videoCreatorFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setVideoCreatorFilter(tab.key)}
                style={{
                  padding: '5px 14px', borderRadius: 6,
                  border: `1px solid ${active ? tab.color : colors.border}`,
                  background: active ? `${tab.color}18` : 'transparent',
                  color: active ? tab.color : colors.textMuted,
                  fontSize: 12, fontWeight: active ? 600 : 400,
                  fontFamily: "'Geist Sans', sans-serif",
                  cursor: 'pointer', transition: 'all 150ms',
                }}
                onMouseEnter={(e) => { if (!active) { e.currentTarget.style.borderColor = colors.borderStrong; e.currentTarget.style.color = colors.text; } }}
                onMouseLeave={(e) => { if (!active) { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.textMuted; } }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Video grid — large cards with real thumbnails */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}>
          {filteredVideos.map((video) => {
            const creatorLabel = video.creator === '3blue1brown' ? '3Blue1Brown' : video.creator === 'ibm-technology' ? 'IBM Technology' : video.creator === 'nvidia' ? 'NVIDIA' : video.creator === 'qiskit' ? 'Qiskit' : video.creator;
            const creatorColor = video.creator === '3blue1brown' ? '#3b82f6' : video.creator === 'ibm-technology' ? '#2563eb' : video.creator === 'nvidia' ? '#22c55e' : '#8b5cf6';
            const diffColor = video.difficulty === 'prerequisite' ? colors.textDim : video.difficulty === 'beginner' ? '#10B981' : video.difficulty === 'intermediate' ? '#F59E0B' : '#EF4444';
            return (
              <button
                key={video.id}
                onClick={() => setPlayingVideo(video.youtubeId)}
                style={{
                  display: 'flex', flexDirection: 'column',
                  background: colors.bgElevated, border: `1px solid ${colors.border}`,
                  borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  overflow: 'hidden', transition: 'all 200ms ease',
                  boxShadow: shadow.sm,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = colors.accent; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = shadow.md; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = shadow.sm; }}
              >
                {/* Thumbnail */}
                <div style={{ width: '100%', paddingBottom: '56.25%', position: 'relative', background: colors.bgPanel }}>
                  <img
                    src={`https://img.youtube.com/vi/${video.youtubeId}/hqdefault.jpg`}
                    alt=""
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="lazy"
                  />
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.25)', opacity: 0, transition: 'opacity 200ms',
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
                  >
                    <div style={{
                      width: 48, height: 48, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.7)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Play size={22} color="#fff" fill="#fff" />
                    </div>
                  </div>
                  {/* Duration badge */}
                  <div style={{
                    position: 'absolute', bottom: 6, right: 6,
                    background: 'rgba(0,0,0,0.8)', color: '#fff',
                    padding: '2px 6px', borderRadius: 4,
                    fontSize: 11, fontFamily: "'Geist Mono', monospace",
                  }}>
                    {video.duration}
                  </div>
                </div>
                {/* Info */}
                <div style={{ padding: '10px 12px' }}>
                  <div style={{
                    color: colors.text, fontSize: 13, fontWeight: 500,
                    fontFamily: "'Geist Sans', sans-serif",
                    lineHeight: 1.3, marginBottom: 6,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {video.title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      padding: '1px 6px', borderRadius: 3,
                      background: `${creatorColor}15`, color: creatorColor,
                      fontSize: 10, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif",
                    }}>
                      {creatorLabel}
                    </span>
                    <span style={{
                      padding: '1px 6px', borderRadius: 3,
                      background: `${diffColor}15`, color: diffColor,
                      fontSize: 10, fontWeight: 500, fontFamily: "'Geist Sans', sans-serif",
                      textTransform: 'capitalize',
                    }}>
                      {video.difficulty}
                    </span>
                  </div>
                  <div style={{
                    color: colors.textDim, fontSize: 11,
                    fontFamily: "'Geist Sans', sans-serif",
                    marginTop: 4, lineHeight: 1.4,
                  }}>
                    {video.description}
                  </div>
                </div>
              </button>
            );
          })}
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
                src={`https://www.youtube-nocookie.com/embed/${playingVideo}?autoplay=1`}
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
