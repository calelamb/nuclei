import { useRef, useEffect } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useLearnStore } from '../../stores/learnStore';
import { useDiracStore } from '../../stores/diracStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
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
      return <ExerciseBlock id={block.id} title={block.title} description={block.description} starterCode={block.starterCode} framework={block.framework} expectedProbabilities={block.expectedProbabilities} tolerancePercent={block.tolerancePercent} hints={block.hints} successMessage={block.successMessage} />;
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
  const completedLessons = useLearnStore((s) => s.completedLessons);
  const scrollRef = useRef<HTMLDivElement>(null);

  const track = getTrack(trackId);
  const lessons = track?.lessons ?? [];
  const currentIndex = lessons.findIndex((l) => l.id === lesson.id);
  const prevLesson = currentIndex > 0 ? lessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < lessons.length - 1 ? lessons[currentIndex + 1] : null;
  const isCompleted = completedLessons.includes(lesson.id);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [lesson.id]);

  // Auto-greeting from Dirac when lesson loads
  const greetedRef = useRef<string | null>(null);
  useEffect(() => {
    if (greetedRef.current === lesson.id) return;
    greetedRef.current = lesson.id;
    // Open Dirac panel and send a greeting
    useDiracPanelStore.getState().open();
    const greeting = `Welcome to **${lesson.title}**! ${lesson.description} I'm here to help — ask me anything as you work through this lesson.`;
    useDiracStore.getState().addMessage({ role: 'assistant', content: greeting });
  }, [lesson.id, lesson.title, lesson.description]);

  const difficultyColor = {
    'absolute-beginner': colors.info,
    beginner: colors.success,
    intermediate: colors.warning,
    advanced: colors.error,
  }[lesson.difficulty];

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: colors.bg,
    }}>
      {/* Top navigation bar */}
      <div style={{
        height: 44,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 12,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
      }}>
        <button
          onClick={clearCurrentLesson}
          title="Back to tracks"
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
          Back
        </button>

        <div style={{ width: 1, height: 16, background: colors.border }} />

        <span style={{
          color: colors.textDim, fontSize: 11,
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          {track?.title}
        </span>

        <span style={{
          color: colors.text, fontSize: 13, fontWeight: 500,
          fontFamily: "'Geist Sans', sans-serif",
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {lesson.title}
        </span>

        {isCompleted && <CheckCircle size={14} color={colors.success} />}

        <span style={{
          color: colors.textDim, fontSize: 11,
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          Lesson {currentIndex + 1} of {lessons.length}
        </span>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
          {lessons.map((l, i) => (
            <div key={l.id} style={{
              width: 6, height: 6, borderRadius: '50%',
              background: completedLessons.includes(l.id) ? colors.success
                : i === currentIndex ? colors.accent
                : colors.border,
              transition: 'background 200ms ease',
            }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => prevLesson && setCurrentLesson(trackId, prevLesson.id)}
            disabled={!prevLesson}
            style={{
              display: 'flex', alignItems: 'center',
              background: 'transparent', border: `1px solid ${colors.border}`,
              borderRadius: 4, padding: '3px 6px',
              color: prevLesson ? colors.textMuted : colors.textDim,
              cursor: prevLesson ? 'pointer' : 'default',
            }}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => nextLesson && setCurrentLesson(trackId, nextLesson.id)}
            disabled={!nextLesson}
            style={{
              display: 'flex', alignItems: 'center',
              background: 'transparent', border: `1px solid ${colors.border}`,
              borderRadius: 4, padding: '3px 6px',
              color: nextLesson ? colors.textMuted : colors.textDim,
              cursor: nextLesson ? 'pointer' : 'default',
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 32px 48px',
        }}
      >
        {/* Lesson header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{
              padding: '2px 8px',
              borderRadius: 4,
              background: `${difficultyColor}18`,
              color: difficultyColor,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "'Geist Sans', sans-serif",
              textTransform: 'capitalize',
            }}>
              {lesson.difficulty}
            </span>
            <span style={{
              color: colors.textDim,
              fontSize: 11,
              fontFamily: "'Geist Sans', sans-serif",
            }}>
              ~{lesson.estimatedMinutes} min
            </span>
          </div>
          <h1 style={{
            color: colors.text,
            fontSize: 28,
            fontWeight: 700,
            fontFamily: "'Geist Sans', sans-serif",
            margin: 0,
            lineHeight: 1.2,
          }}>
            {lesson.title}
          </h1>
          <p style={{
            color: colors.textMuted,
            fontSize: 15,
            fontFamily: "'Geist Sans', sans-serif",
            margin: '8px 0 0',
            lineHeight: 1.5,
          }}>
            {lesson.description}
          </p>
        </div>

        {/* Content blocks */}
        {lesson.contentBlocks.map((block, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <ContentBlockRenderer block={block} />
          </div>
        ))}

        {/* Next lesson prompt */}
        {nextLesson && (
          <div style={{
            marginTop: 32,
            padding: 20,
            background: colors.bgElevated,
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: shadow.sm,
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
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 20px',
                background: colors.accent,
                color: '#fff', border: 'none', borderRadius: 8,
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
