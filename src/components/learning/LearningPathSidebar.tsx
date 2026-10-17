import { useState } from 'react';
import { ChevronRight, ChevronDown, CheckCircle2, Circle, CircleDot, Maximize2, BookOpen, Network, Trophy, Library } from 'lucide-react';
import { useLearnStore } from '../../stores/learnStore';
import { TRACKS } from '../../data/lessons/tracks';
import { ConceptSummary } from './ConceptSummary';
import { Glossary } from './Glossary';
import { CapstonesPanel } from './CapstonesPanel';
import { Button, Tabs, type TabOption } from '../ui';
import { useLearnSectionStore } from './learnSectionStore';
import './learnSidebar.css';

type TabKey = 'tracks' | 'concepts' | 'capstones' | 'glossary';

/** Icon tabs below 280px: the label stays in the DOM for assistive tech and the tooltip. */
const TAB_OPTIONS: ReadonlyArray<TabOption<TabKey>> = [
  { value: 'tracks', label: <span className="lpath__tab-inner" title="Tracks"><BookOpen size={14} aria-hidden="true" /><span className="lpath__tab-label">Tracks</span></span> },
  { value: 'concepts', label: <span className="lpath__tab-inner" title="Concepts"><Network size={14} aria-hidden="true" /><span className="lpath__tab-label">Concepts</span></span> },
  { value: 'capstones', label: <span className="lpath__tab-inner" title="Capstones"><Trophy size={14} aria-hidden="true" /><span className="lpath__tab-label">Capstones</span></span> },
  { value: 'glossary', label: <span className="lpath__tab-inner" title="Glossary"><Library size={14} aria-hidden="true" /><span className="lpath__tab-label">Glossary</span></span> },
];

/**
 * The Tracks tab — the ONE lessons model (PRD polish: the rail and the
 * full-view Learn mode now show the same TRACKS, not a second Paths/Modules
 * hierarchy). An accordion of tracks; expand to see lessons with completed /
 * current state; click a lesson to open it in Learn mode.
 */
function TracksTab() {
  const currentTrackId = useLearnStore((s) => s.currentTrackId);
  const currentLessonId = useLearnStore((s) => s.currentLessonId);
  const completedLessons = useLearnStore((s) => s.completedLessons);
  const setCurrentLesson = useLearnStore((s) => s.setCurrentLesson);
  const enterLearnMode = useLearnStore((s) => s.enterLearnMode);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = currentTrackId ?? TRACKS.find((t) => t.lessons.length > 0)?.id;
    return new Set(initial ? [initial] : []);
  });

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openLesson = (trackId: string, lessonId: string) => {
    setCurrentLesson(trackId, lessonId);
    enterLearnMode();
  };

  return (
    <div className="lpath__tracks">
      {TRACKS.map((track) => {
        const total = track.lessons.length;
        const done = track.lessons.filter((l) => completedLessons.includes(l.id)).length;
        const isOpen = expanded.has(track.id);
        return (
          <div key={track.id}>
            <button type="button" className="lpath__row lpath__track" aria-expanded={isOpen} onClick={() => toggle(track.id)}>
              {isOpen ? <ChevronDown size={14} className="lpath__icon" /> : <ChevronRight size={14} className="lpath__icon" />}
              <span className="lpath__track-title">{track.title}</span>
              <span className="lpath__count">{done}/{total}</span>
            </button>
            {isOpen && track.lessons.map((lesson, i) => {
              const isCurrent = lesson.id === currentLessonId && track.id === currentTrackId;
              const isDone = completedLessons.includes(lesson.id);
              const title = `${i + 1}. ${lesson.title}`;
              return (
                <button
                  key={lesson.id}
                  type="button"
                  className="lpath__row lpath__lesson"
                  aria-current={isCurrent ? 'true' : undefined}
                  title={title}
                  onClick={() => openLesson(track.id, lesson.id)}
                >
                  {isDone ? (
                    <CheckCircle2 size={14} className="lpath__icon lpath__icon--done" />
                  ) : isCurrent ? (
                    <CircleDot size={14} className="lpath__icon lpath__icon--current" />
                  ) : (
                    <Circle size={12} className="lpath__icon lpath__icon--todo" />
                  )}
                  <span className="lpath__lesson-title">{title}</span>
                </button>
              );
            })}
            {isOpen && total === 0 && <div className="lpath__soon">Coming soon</div>}
          </div>
        );
      })}
    </div>
  );
}

export function LearningPathSidebar() {
  const [activeTab, setActiveTab] = useState<TabKey>('tracks');
  const setSection = useLearnSectionStore((s) => s.setSection);
  const clearCurrentLesson = useLearnStore((s) => s.clearCurrentLesson);
  const enterLearnMode = useLearnStore((s) => s.enterLearnMode);

  const openFullView = () => {
    setSection(activeTab);
    clearCurrentLesson();
    enterLearnMode();
  };

  return (
    <div className="lpath">
      <Tabs className="lpath__tabs" aria-label="Learn sections" value={activeTab} options={TAB_OPTIONS} onChange={setActiveTab} />

      <div className="lpath__panel" role="tabpanel" aria-label={`${activeTab} panel`}>
        {activeTab === 'tracks' && <TracksTab />}
        {activeTab === 'concepts' && <ConceptSummary />}
        {activeTab === 'capstones' && <CapstonesPanel />}
        {activeTab === 'glossary' && <Glossary />}
      </div>

      {activeTab === 'concepts' && (
        <div className="lpath__foot">
          <Button size="sm" variant="secondary" icon={<Maximize2 size={12} aria-hidden="true" />} onClick={openFullView}>
            Open full map
          </Button>
        </div>
      )}
    </div>
  );
}
