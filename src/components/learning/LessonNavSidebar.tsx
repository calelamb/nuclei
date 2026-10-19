import { scheduleLandingFocus } from '../onboarding/focusLanding';
import { useMemo } from 'react';
import { CheckCircle2, Circle, CircleDot, PanelLeftClose, PanelLeft, Network, Trophy, Library, PlayCircle } from 'lucide-react';
import { useLearnStore } from '../../stores/learnStore';
import { getTrack } from '../../data/lessons/tracks';
import type { ContentBlock } from '../../data/lessons/types';
import { IconButton } from '../ui';
import { blockMeta, blockOutlineLabel } from './lessonOutline';
import { LEARN_SECTION_LABELS, useLearnSectionStore, type LearnSection } from './learnSectionStore';
import { scrollLessonBlock } from './scrollLessonBlock';
import './lessonNav.css';

const SECTION_LINKS: ReadonlyArray<{ section: LearnSection; icon: typeof Network }> = [
  { section: 'concepts', icon: Network },
  { section: 'capstones', icon: Trophy },
  { section: 'glossary', icon: Library },
  { section: 'videos', icon: PlayCircle },
];

/**
 * The in-lesson navigation column (PRD-less polish): answers "where am I?"
 * inside a track. Shows the track ("epic") header with overall progress, the
 * full lesson list with completed/current/upcoming state (click to jump), and
 * the current lesson's block outline with a scroll-spy active highlight. Reads
 * `currentBlockIndex` (set by LessonView's IntersectionObserver) so the
 * outline tracks the reader. Collapsible to a thin rail.
 */
export function LessonNavSidebar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const currentTrackId = useLearnStore((s) => s.currentTrackId);
  const currentLessonId = useLearnStore((s) => s.currentLessonId);
  const currentBlockIndex = useLearnStore((s) => s.currentBlockIndex);
  const completedLessons = useLearnStore((s) => s.completedLessons);
  const setCurrentLesson = useLearnStore((s) => s.setCurrentLesson);
  const clearCurrentLesson = useLearnStore((s) => s.clearCurrentLesson);
  const setSection = useLearnSectionStore((s) => s.setSection);
  const setReturnTo = useLearnSectionStore((s) => s.setReturnTo);

  const track = currentTrackId ? getTrack(currentTrackId) : undefined;
  const lessons = useMemo(() => track?.lessons ?? [], [track]);
  const currentLesson = lessons.find((l) => l.id === currentLessonId);
  const completedInTrack = lessons.filter((l) => completedLessons.includes(l.id)).length;

  if (!track) return null;

  if (collapsed) {
    return (
      <div className="lnav lnav--collapsed">
        <IconButton aria-label="Show lesson navigation" onClick={onToggleCollapsed}>
          <PanelLeft size={16} />
        </IconButton>
      </div>
    );
  }

  const percent = lessons.length ? (completedInTrack / lessons.length) * 100 : 0;

  return (
    <nav className="lnav" aria-label="Lesson navigation">
      <div className="lnav__head">
        <div className="lnav__head-row">
          <div className="lnav__head-text">
            <div className="lnav__eyebrow">Track</div>
            <div className="lnav__track">{track.title}</div>
          </div>
          <IconButton size="sm" aria-label="Hide lesson navigation" onClick={onToggleCollapsed}>
            <PanelLeftClose size={16} />
          </IconButton>
        </div>
        <div className="lnav__progress">
          <div className="lnav__bar" role="progressbar" aria-label="Track progress" aria-valuemin={0} aria-valuemax={lessons.length} aria-valuenow={completedInTrack}>
            <div className="lnav__bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="lnav__count">{completedInTrack}/{lessons.length}</span>
        </div>
      </div>

      <div className="lnav__list">
        {lessons.map((lesson, i) => {
          const isCurrent = lesson.id === currentLessonId;
          const isDone = completedLessons.includes(lesson.id);
          const title = `${i + 1}. ${lesson.title}`;
          return (
            <div key={lesson.id}>
              <button
                type="button"
                className="lnav__lesson"
                aria-current={isCurrent ? 'true' : undefined}
                title={title}
                onClick={() => setCurrentLesson(track.id, lesson.id)}
              >
                {isDone ? (
                  <CheckCircle2 size={16} className="lnav__icon lnav__icon--done" />
                ) : isCurrent ? (
                  <CircleDot size={14} className="lnav__icon lnav__icon--current" />
                ) : (
                  <Circle size={14} className="lnav__icon lnav__icon--todo" />
                )}
                <span className="lnav__label">{title}</span>
              </button>

              {isCurrent && currentLesson && currentLesson.contentBlocks.length > 1 && (
                <div className="lnav__outline">
                  {currentLesson.contentBlocks.map((block: ContentBlock, bi) => {
                    const Icon = blockMeta(block).icon;
                    const label = blockOutlineLabel(block);
                    return (
                      <button
                        key={bi}
                        type="button"
                        className="lnav__outline-item"
                        aria-current={bi === currentBlockIndex ? 'true' : undefined}
                        title={label}
                        onClick={() => scrollLessonBlock(bi, 'smooth')}
                      >
                        <Icon size={12} className="lnav__icon" />
                        <span className="lnav__label">{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="lnav__foot" role="group" aria-label="More ways to learn">
        {SECTION_LINKS.map(({ section, icon: Icon }) => (
          <button
            key={section}
            type="button"
            className="lnav__foot-link"
            onClick={() => {
              if (currentTrackId && currentLessonId) {
                setReturnTo({ trackId: currentTrackId, lessonId: currentLessonId, blockIndex: currentBlockIndex });
              }
              setSection(section);
              clearCurrentLesson();
              // The lesson (and the link that was focused) is gone; land on the chooser heading.
              scheduleLandingFocus();
            }}
          >
            <Icon size={12} aria-hidden="true" />
            {LEARN_SECTION_LABELS[section]}
          </button>
        ))}
      </div>
    </nav>
  );
}
