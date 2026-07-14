import { useState } from 'react';
import { ChevronRight, ChevronDown, CheckCircle2, Circle, Dot } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useLearnStore } from '../../stores/learnStore';
import { useCapstoneStore } from '../../stores/capstoneStore';
import { TRACKS } from '../../data/lessons/tracks';
import { CAPSTONE_PROJECTS } from '../../data/capstoneProjects';
import { ConceptMap } from './ConceptMap';
import { Glossary } from './Glossary';
import { CapstoneCard } from './CapstoneCard';
import { CapstoneProjectView } from './CapstoneProject';

type TabKey = 'tracks' | 'concepts' | 'capstones' | 'glossary';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'tracks', label: 'Tracks' },
  { key: 'concepts', label: 'Concepts' },
  { key: 'capstones', label: 'Capstones' },
  { key: 'glossary', label: 'Glossary' },
];

interface ColorSet {
  bg: string; bgElevated: string; border: string; text: string;
  textMuted: string; textDim: string; accent: string; success: string;
}

/**
 * The Tracks tab — the ONE lessons model (PRD polish: the rail and the
 * full-view Learn mode now show the same TRACKS, not a second Paths/Modules
 * hierarchy). An accordion of tracks; expand to see lessons with completed /
 * current state; click a lesson to open it in Learn mode.
 */
function TracksTab() {
  const colors = useThemeStore((s) => s.colors) as ColorSet;
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
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0' }}>
      {TRACKS.map((track) => {
        const total = track.lessons.length;
        const done = track.lessons.filter((l) => completedLessons.includes(l.id)).length;
        const isOpen = expanded.has(track.id);
        return (
          <div key={track.id}>
            <button
              onClick={() => toggle(track.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                padding: '7px 12px', background: 'transparent', border: 'none', cursor: 'pointer',
                color: colors.textMuted, fontFamily: "'Geist Sans', sans-serif",
              }}
            >
              {isOpen ? <ChevronDown size={13} style={{ flexShrink: 0 }} /> : <ChevronRight size={13} style={{ flexShrink: 0 }} />}
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {track.title}
              </span>
              <span style={{ fontSize: 10, color: colors.textDim, fontVariantNumeric: 'tabular-nums' }}>
                {done}/{total}
              </span>
            </button>
            {isOpen && track.lessons.map((lesson, i) => {
              const isCurrent = lesson.id === currentLessonId && track.id === currentTrackId;
              const isDone = completedLessons.includes(lesson.id);
              return (
                <button
                  key={lesson.id}
                  onClick={() => openLesson(track.id, lesson.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    padding: '6px 12px 6px 28px', border: 'none', cursor: 'pointer',
                    background: isCurrent ? `${colors.accent}14` : 'transparent',
                    borderLeft: `2px solid ${isCurrent ? colors.accent : 'transparent'}`,
                    color: isCurrent ? colors.text : colors.textMuted,
                    fontWeight: isCurrent ? 600 : 400, fontFamily: "'Geist Sans', sans-serif",
                  }}
                  onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = colors.bgElevated; }}
                  onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
                >
                  {isDone ? (
                    <CheckCircle2 size={13} style={{ color: colors.success, flexShrink: 0 }} />
                  ) : isCurrent ? (
                    <Dot size={14} style={{ color: colors.accent, flexShrink: 0 }} />
                  ) : (
                    <Circle size={11} style={{ color: colors.textDim, flexShrink: 0 }} />
                  )}
                  <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {i + 1}. {lesson.title}
                  </span>
                </button>
              );
            })}
            {isOpen && total === 0 && (
              <div style={{ padding: '2px 12px 8px 30px', fontSize: 11, color: colors.textDim, fontFamily: "'Geist Sans', sans-serif" }}>
                Coming soon
              </div>
            )}
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
    <div style={{ padding: 12, minHeight: 0, overflowY: 'auto', flex: 1 }}>
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
  const colors = useThemeStore((s) => s.colors);
  const [activeTab, setActiveTab] = useState<TabKey>('tracks');

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: colors.bg,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1, padding: '6px 0', background: 'transparent', border: 'none',
                borderBottom: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
                color: isActive ? colors.accent : colors.textDim,
                fontSize: 10, fontWeight: 600, fontFamily: "'Geist Sans', sans-serif",
                textTransform: 'uppercase', letterSpacing: '0.3px', cursor: 'pointer',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'tracks' && <TracksTab />}
        {activeTab === 'concepts' && <ConceptMap />}
        {activeTab === 'capstones' && <CapstonesTab />}
        {activeTab === 'glossary' && <Glossary />}
      </div>
    </div>
  );
}
