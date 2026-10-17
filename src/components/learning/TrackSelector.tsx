import { BookOpen, ChevronRight, CheckCircle, Lock } from 'lucide-react';
import { useLearnStore } from '../../stores/learnStore';
import { TRACKS } from '../../data/lessons/tracks';
import type { Track } from '../../data/lessons/types';
import { TrackVideoShelf } from './TrackVideoShelf';
import { ConceptMap } from './ConceptMap';
import { Glossary } from './Glossary';
import { CapstonesPanel } from './CapstonesPanel';
import { LEARN_SECTION_LABELS, useLearnSectionStore, type LearnSection } from './learnSectionStore';
import { Tabs, type TabOption } from '../ui';
import './trackSelector.css';

interface TrackCardProps {
  track: Track;
  completedLessons: readonly string[];
  started: boolean;
  onOpen: (trackId: string, lessonId: string) => void;
}

function TrackCard({ track, completedLessons, started, onOpen }: TrackCardProps) {
  const lessonCount = track.lessons.length;
  const hasLessons = lessonCount > 0;
  const completed = track.lessons.filter((l) => completedLessons.includes(l.id)).length;
  const resume = track.lessons.find((l) => !completedLessons.includes(l.id)) ?? track.lessons[0];
  const allDone = hasLessons && completed === lessonCount;

  return (
    <button
      type="button"
      className="track-card"
      disabled={!hasLessons}
      onClick={() => { if (resume) onOpen(track.id, resume.id); }}
    >
      <span className="track-card__num" aria-hidden="true">
        {allDone ? <CheckCircle size={20} /> : !hasLessons ? <Lock size={16} /> : track.id.split('-')[1]}
      </span>
      <span className="track-card__body">
        <span className="track-card__title">{track.title}</span>
        <span className="track-card__desc">{track.description}</span>
        <span className="track-card__meta">
          <span>{hasLessons ? `${lessonCount} lessons` : 'Coming soon'}</span>
          <span className="track-card__level">{track.difficulty}</span>
          {started && hasLessons && (
            <>
              <span className="track-card__bar" role="progressbar" aria-label={`${track.title} progress`} aria-valuemin={0} aria-valuemax={lessonCount} aria-valuenow={completed}>
                <span className="track-card__bar-fill" style={{ width: `${(completed / lessonCount) * 100}%` }} />
              </span>
              <span>{completed}/{lessonCount}</span>
            </>
          )}
        </span>
      </span>
      {hasLessons && <ChevronRight className="track-card__chevron" size={20} aria-hidden="true" />}
    </button>
  );
}

const SECTION_ORDER: readonly LearnSection[] = ['tracks', 'concepts', 'capstones', 'glossary', 'videos'];
const SECTION_OPTIONS: ReadonlyArray<TabOption<LearnSection>> = SECTION_ORDER.map((value) => ({
  value,
  label: LEARN_SECTION_LABELS[value],
}));

function TrackList() {
  const setCurrentLesson = useLearnStore((s) => s.setCurrentLesson);
  const completedLessons = useLearnStore((s) => s.completedLessons);
  const lessonProgress = useLearnStore((s) => s.lessonProgress);

  return (
    <div className="tracks__list">
      {TRACKS.map((track) => (
        <TrackCard
          key={track.id}
          track={track}
          completedLessons={completedLessons}
          started={track.lessons.some((l) => lessonProgress[l.id])}
          onOpen={setCurrentLesson}
        />
      ))}
    </div>
  );
}

function SectionBody({ section }: { section: LearnSection }) {
  switch (section) {
    case 'tracks':
      return <TrackList />;
    case 'concepts':
      return <div className="tracks__concepts"><ConceptMap /></div>;
    case 'capstones':
      return <div className="tracks__capstones"><CapstonesPanel /></div>;
    case 'glossary':
      return <div className="tracks__glossary"><Glossary /></div>;
    case 'videos':
      return <TrackVideoShelf />;
  }
}

export function TrackSelector() {
  const section = useLearnSectionStore((s) => s.section);
  const setSection = useLearnSectionStore((s) => s.setSection);

  return (
    <div className="tracks">
      <div className="tracks__inner">
        <header className="tracks__header">
          <span className="tracks__badge"><BookOpen size={20} aria-hidden="true" /></span>
          <div>
            <h1 className="tracks__title">Learn Quantum Computing</h1>
            <p className="tracks__lede">Code-first lessons with interactive demos. Watch, play, prove.</p>
          </div>
        </header>

        <Tabs className="tracks__tabs" aria-label="Learn sections" value={section} options={SECTION_OPTIONS} onChange={setSection} />
        <div className="tracks__section" role="tabpanel" aria-label={LEARN_SECTION_LABELS[section]}>
          <SectionBody section={section} />
        </div>
      </div>
    </div>
  );
}
