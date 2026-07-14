import { useRef, useEffect } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useLearnStore } from '../../stores/learnStore';
import { getTrack } from '../../data/lessons/tracks';
import { TextBlock } from './TextBlock';
import { VideoPlayer } from './VideoPlayer';
import { InteractiveDemo } from './InteractiveDemo';
import { ExerciseBlock } from './ExerciseBlock';
import { QuizBlock } from './QuizBlock';
import { ConceptCard } from './ConceptCard';
import { InteractiveBlochSphere } from './InteractiveBlochSphere';
import type { Lesson, ContentBlock } from '../../data/lessons/types';
import { ArrowLeft, ChevronLeft, ChevronRight, CheckCircle } from 'lucide-react';

function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text':
      return <TextBlock markdown={block.markdown} />;
    case 'video':
      return <VideoPlayer youtubeId={block.youtubeId} title={block.title} creator={block.creator} startTime={block.startTime} endTime={block.endTime} />;
    case 'demo':
      return <InteractiveDemo code={block.code} framework={block.framework} description={block.description} explorationPrompt={block.explorationPrompt} />;
    case 'exercise':
      return <ExerciseBlock id={block.id} title={block.title} description={block.description} starterCode={block.starterCode} framework={block.framework} expectedProbabilities={block.expectedProbabilities} expectedMeasurements={block.expectedMeasurements} tolerancePercent={block.tolerancePercent} hints={block.hints} successMessage={block.successMessage} />;
    case 'quiz':
      return <QuizBlock questions={block.questions} />;
    case 'concept-card':
      return <ConceptCard title={block.title} visual={block.visual} explanation={block.explanation} />;
    case 'interactive-bloch':
      return <InteractiveBlochSphere initialTheta={block.initialTheta} initialPhi={block.initialPhi} availableGates={block.availableGates} challenge={block.challenge} />;
    default:
      return null;
  }
}

interface LessonViewProps {
  lesson: Lesson;
  trackId: string;
}

export function LessonView({ lesson, trackId }: LessonViewProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const clearCurrentLesson = useLearnStore((s) => s.clearCurrentLesson);
  const setCurrentLesson = useLearnStore((s) => s.setCurrentLesson);
  const setCurrentBlockIndex = useLearnStore((s) => s.setCurrentBlockIndex);
  const currentBlockIndex = useLearnStore((s) => s.currentBlockIndex);
  const completedLessons = useLearnStore((s) => s.completedLessons);
  const scrollRef = useRef<HTMLDivElement>(null);

  const track = getTrack(trackId);
  const lessons = track?.lessons ?? [];
  const currentIndex = lessons.findIndex((l) => l.id === lesson.id);
  const prevLesson = currentIndex > 0 ? lessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < lessons.length - 1 ? lessons[currentIndex + 1] : null;
  const isCompleted = completedLessons.includes(lesson.id);
  const blockCount = lesson.contentBlocks.length;

  // New lesson: jump to top and reset the reading position.
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
    setCurrentBlockIndex(0);
  }, [lesson.id, setCurrentBlockIndex]);

  // Scroll-spy: mark the topmost visible block as current so the nav sidebar's
  // outline follows the reader. A trigger line near the top of the viewport
  // (rootMargin) decides which block "counts" as active.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-block-index]'));
    if (els.length === 0) return;
    const visible = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const idx = Number(e.target.getAttribute('data-block-index'));
          if (e.isIntersecting) visible.add(idx);
          else visible.delete(idx);
        }
        if (visible.size > 0) setCurrentBlockIndex(Math.min(...visible));
      },
      { root, rootMargin: '0px 0px -65% 0px', threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [lesson.id, setCurrentBlockIndex]);

  const difficultyColor = {
    'absolute-beginner': colors.info,
    beginner: colors.success,
    intermediate: colors.warning,
    advanced: colors.error,
  }[lesson.difficulty];

  const readProgress = blockCount > 0 ? Math.min(1, (currentBlockIndex + 1) / blockCount) : 0;

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: colors.bg,
    }}>
      {/* Top bar: breadcrumb + position + prev/next */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        height: 44,
        gap: 10,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
      }}>
        <button
          onClick={clearCurrentLesson}
          title="Back to all tracks"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'transparent', border: 'none',
            color: colors.textMuted, cursor: 'pointer',
            fontSize: 12, fontFamily: "'Geist Sans', sans-serif",
            padding: '4px 8px', borderRadius: 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; e.currentTarget.style.background = colors.bgElevated; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.background = 'transparent'; }}
        >
          <ArrowLeft size={14} />
          Tracks
        </button>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, fontFamily: "'Geist Sans', sans-serif" }}>
          <span style={{ color: colors.textDim, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
            {track?.title}
          </span>
          <ChevronRight size={12} color={colors.textDim} style={{ flexShrink: 0 }} />
          <span style={{ color: colors.text, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {lesson.title}
          </span>
          {isCompleted && <CheckCircle size={14} color={colors.success} style={{ flexShrink: 0 }} />}
        </div>

        <span style={{ color: colors.textDim, fontSize: 11, fontFamily: "'Geist Sans', sans-serif", whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          Lesson {currentIndex + 1} / {lessons.length}
        </span>

        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => prevLesson && setCurrentLesson(trackId, prevLesson.id)}
            disabled={!prevLesson}
            title={prevLesson ? `Previous: ${prevLesson.title}` : 'No previous lesson'}
            style={navBtn(colors, !!prevLesson)}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => nextLesson && setCurrentLesson(trackId, nextLesson.id)}
            disabled={!nextLesson}
            title={nextLesson ? `Next: ${nextLesson.title}` : 'No next lesson'}
            style={navBtn(colors, !!nextLesson)}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Within-lesson reading progress */}
      <div style={{ flexShrink: 0, height: 2, background: colors.border }}>
        <div style={{ width: `${readProgress * 100}%`, height: '100%', background: colors.accent, transition: 'width 200ms ease' }} />
      </div>

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '24px 32px 64px',
        }}
      >
        {/* Lesson header */}
        <div style={{ marginBottom: 24, maxWidth: 760 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{
              padding: '2px 8px', borderRadius: 4,
              background: `${difficultyColor}18`, color: difficultyColor,
              fontSize: 11, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif",
              textTransform: 'capitalize',
            }}>
              {lesson.difficulty.replace('-', ' ')}
            </span>
            <span style={{ color: colors.textDim, fontSize: 11, fontFamily: "'Geist Sans', sans-serif" }}>
              ~{lesson.estimatedMinutes} min
            </span>
          </div>
          <h1 style={{ color: colors.text, fontSize: 28, fontWeight: 700, fontFamily: "'Geist Sans', sans-serif", margin: 0, lineHeight: 1.2 }}>
            {lesson.title}
          </h1>
          <p style={{ color: colors.textMuted, fontSize: 15, fontFamily: "'Geist Sans', sans-serif", margin: '8px 0 0', lineHeight: 1.5 }}>
            {lesson.description}
          </p>
        </div>

        {/* Content blocks */}
        {lesson.contentBlocks.map((block, i) => (
          <div key={i} id={`block-${i}`} data-block-index={i} style={{ marginBottom: 8, scrollMarginTop: 16, maxWidth: 760 }}>
            <ContentBlockRenderer block={block} />
          </div>
        ))}

        {/* Next lesson prompt */}
        {nextLesson && (
          <div style={{
            marginTop: 32, maxWidth: 760, padding: 20,
            background: colors.bgElevated, border: `1px solid ${colors.border}`,
            borderRadius: 12, display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', boxShadow: shadow.sm,
          }}>
            <div>
              <div style={{ color: colors.textDim, fontSize: 12, fontFamily: "'Geist Sans', sans-serif", marginBottom: 4 }}>
                Up next
              </div>
              <div style={{ color: colors.text, fontSize: 15, fontWeight: 500, fontFamily: "'Geist Sans', sans-serif" }}>
                {nextLesson.title}
              </div>
            </div>
            <button
              onClick={() => setCurrentLesson(trackId, nextLesson.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px',
                background: colors.accent, color: '#fff', border: 'none', borderRadius: 8,
                fontSize: 13, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif",
                cursor: 'pointer', boxShadow: shadow.sm,
              }}
            >
              Next Lesson <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function navBtn(colors: { border: string; textMuted: string; textDim: string }, enabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center',
    background: 'transparent', border: `1px solid ${colors.border}`,
    borderRadius: 4, padding: '3px 6px',
    color: enabled ? colors.textMuted : colors.textDim,
    cursor: enabled ? 'pointer' : 'default',
  };
}
