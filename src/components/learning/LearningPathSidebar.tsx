import { useState } from 'react';
import { ChevronRight, ChevronDown, CheckCircle2, Circle, Dot } from 'lucide-react';
import { useLearnStore } from '../../stores/learnStore';
import { useCapstoneStore } from '../../stores/capstoneStore';
import { TRACKS } from '../../data/lessons/tracks';
import { CAPSTONE_PROJECTS } from '../../data/capstoneProjects';
import { ConceptMap } from './ConceptMap';
import { Glossary } from './Glossary';
import { CapstoneCard } from './CapstoneCard';
import { CapstoneProjectView } from './CapstoneProject';
import './learnSidebar.css';

type TabKey = 'tracks' | 'concepts' | 'capstones' | 'glossary';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'tracks', label: 'Tracks' },
  { key: 'concepts', label: 'Concepts' },
  { key: 'capstones', label: 'Capstones' },
  { key: 'glossary', label: 'Glossary' },
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
                    <Dot size={14} className="lpath__icon lpath__icon--current" />
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

function CapstonesTab() {
  const { activeProject, completedMilestones, startProject } = useCapstoneStore();

  if (activeProject) {
    return <CapstoneProjectView />;
  }

  return (
    <div className="lpath__caps">
      {CAPSTONE_PROJECTS.map((project) => {
        const completed = completedMilestones[project.id] ?? [];
        return (
          <CapstoneCard
            key={project.id}
            project={project}
            completedCount={completed.length}
            onStart={() => startProject(project)}
          />
        );
      })}
    </div>
  );
}

export function LearningPathSidebar() {
  const [activeTab, setActiveTab] = useState<TabKey>('tracks');

  return (
    <div className="lpath">
      <div className="lpath__tabs" role="tablist" aria-label="Learn sections">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`lpath-tab-${tab.key}`}
            aria-selected={activeTab === tab.key}
            aria-controls="lpath-panel"
            className="lpath__tab"
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="lpath__panel" id="lpath-panel" role="tabpanel" aria-labelledby={`lpath-tab-${activeTab}`}>
        {activeTab === 'tracks' && <TracksTab />}
        {activeTab === 'concepts' && <ConceptMap />}
        {activeTab === 'capstones' && <CapstonesTab />}
        {activeTab === 'glossary' && <Glossary />}
      </div>
    </div>
  );
}
