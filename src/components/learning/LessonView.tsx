import { useRef, useEffect } from 'react';
import { useLearnSectionStore } from './learnSectionStore';
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
import { Badge, Button, IconButton } from '../ui';
import { LESSON_LEVEL_TONE } from './levelTone';
import './lessonView.css';

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
  const clearCurrentLesson = useLearnStore((s) => s.clearCurrentLesson);
  const setCurrentLesson = useLearnStore((s) => s.setCurrentLesson);
  const setCurrentBlockIndex = useLearnStore((s) => s.setCurrentBlockIndex);
  const currentBlockIndex = useLearnStore((s) => s.currentBlockIndex);
  const completedLessons = useLearnStore((s) => s.completedLessons);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const setReturnTo = useLearnSectionStore((s) => s.setReturnTo);

  const track = getTrack(trackId);
  const lessons = track?.lessons ?? [];
  const currentIndex = lessons.findIndex((l) => l.id === lesson.id);
  const prevLesson = currentIndex > 0 ? lessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < lessons.length - 1 ? lessons[currentIndex + 1] : null;
  const isCompleted = completedLessons.includes(lesson.id);
  const completedInTrack = lessons.filter((l) => completedLessons.includes(l.id)).length;
  const blockCount = lesson.contentBlocks.length;

  // New lesson: land on its heading (so keyboard and screen-reader users start here, not on <body>),
  // then either return to a remembered reading position or jump to the top.
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    const { restore, setRestore } = useLearnSectionStore.getState();
    if (restore && restore.lessonId === lesson.id) {
      setRestore(null);
      setCurrentBlockIndex(restore.blockIndex);
      const frame = requestAnimationFrame(() => {
        document.getElementById(`block-${restore.blockIndex}`)?.scrollIntoView({ block: 'start' });
      });
      return () => cancelAnimationFrame(frame);
    }
    scrollRef.current?.scrollTo(0, 0);
    setCurrentBlockIndex(0);
    return undefined;
  }, [lesson.id, setCurrentBlockIndex]);

  const leaveToTracks = () => {
    setReturnTo({ trackId, lessonId: lesson.id, blockIndex: currentBlockIndex });
    clearCurrentLesson();
  };

  // Scroll-spy: mark the topmost visible block as current so the nav sidebar's
  // outline follows the reader. A thin band about 30% down
  // the reader (rootMargin) decides which block "counts" as active, so a block is current once it
  // is mostly on screen rather than while only its tail is still visible.
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
      { root, rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [lesson.id, setCurrentBlockIndex]);

  const readProgress = blockCount > 0 ? Math.min(1, (currentBlockIndex + 1) / blockCount) : 0;

  return (
    <div className="lesson">
      <div className="lesson__bar">
        <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={leaveToTracks} title="Back to all tracks">
          Tracks
        </Button>

        <div className="lesson__crumbs">
          <span className="lesson__crumb-track">{track?.title}</span>
          <ChevronRight className="lesson__crumb-sep" size={12} aria-hidden="true" />
          <span className="lesson__crumb-title">{lesson.title}</span>
          {isCompleted && <CheckCircle className="lesson__done" size={14} aria-label="Completed" />}
        </div>

        <span className="lesson__position">Lesson {currentIndex + 1} / {lessons.length}</span>

        <div className="lesson__steps">
          <IconButton
            variant="secondary"
            size="sm"
            aria-label={prevLesson ? `Previous lesson: ${prevLesson.title}` : 'No previous lesson'}
            disabled={!prevLesson}
            onClick={() => prevLesson && setCurrentLesson(trackId, prevLesson.id)}
          >
            <ChevronLeft size={14} />
          </IconButton>
          <IconButton
            variant="secondary"
            size="sm"
            aria-label={nextLesson ? `Next lesson: ${nextLesson.title}` : 'No next lesson'}
            disabled={!nextLesson}
            onClick={() => nextLesson && setCurrentLesson(trackId, nextLesson.id)}
          >
            <ChevronRight size={14} />
          </IconButton>
        </div>
      </div>

      <div className="lesson__progress" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(readProgress * 100)}>
        <div className="lesson__progress-fill" style={{ width: `${readProgress * 100}%` }} />
      </div>

      <div ref={scrollRef} className="lesson__scroll">
        <header className="lesson__header">
          <div className="lesson__meta">
            <Badge tone={LESSON_LEVEL_TONE[lesson.difficulty]} style={{ textTransform: 'capitalize' }}>
              {lesson.difficulty.replace('-', ' ')}
            </Badge>
            <span>~{lesson.estimatedMinutes} min</span>
          </div>
          <h1 ref={titleRef} tabIndex={-1} className="lesson__title">{lesson.title}</h1>
          <p className="lesson__lede">{lesson.description}</p>
        </header>

        {lesson.contentBlocks.map((block, i) => (
          <div key={i} id={`block-${i}`} data-block-index={i} className="lesson__block">
            <ContentBlockRenderer block={block} />
          </div>
        ))}

        {(nextLesson || isCompleted) && (
          <div className={isCompleted ? 'lesson__next lesson__next--done' : 'lesson__next'} data-complete={isCompleted}>
            <div className="lesson__next-text">
              <div className="lesson__next-kicker">
                {isCompleted ? (
                  <>
                    <CheckCircle className="lesson__next-check" size={14} aria-hidden="true" />
                    Lesson complete · {completedInTrack} of {lessons.length}
                  </>
                ) : 'Up next'}
              </div>
              {nextLesson && <div className="lesson__next-title">{isCompleted ? `Up next: ${nextLesson.title}` : nextLesson.title}</div>}
            </div>
            {nextLesson && (
              <Button variant="primary" size="lg" onClick={() => setCurrentLesson(trackId, nextLesson.id)}>
                Next lesson <ChevronRight size={16} aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
