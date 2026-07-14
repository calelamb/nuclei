import { useCallback, useState } from 'react';
import { useLearnStore } from '../../stores/learnStore';
import { useThemeStore } from '../../stores/themeStore';
import { getLesson } from '../../data/lessons/tracks';
import { TrackSelector } from './TrackSelector';
import { LessonView } from './LessonView';
import { LessonNavSidebar } from './LessonNavSidebar';
import { DiracSidePanel } from '../dirac/DiracSidePanel';

const COLLAPSE_KEY = 'nuclei-lesson-nav-collapsed';

export function LearnModeView() {
  const colors = useThemeStore((s) => s.colors);
  const currentTrackId = useLearnStore((s) => s.currentTrackId);
  const currentLessonId = useLearnStore((s) => s.currentLessonId);

  const lesson = currentTrackId && currentLessonId
    ? getLesson(currentTrackId, currentLessonId)
    : null;

  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleNav = useCallback(() => {
    setNavCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* non-critical */
      }
      return next;
    });
  }, []);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      overflow: 'hidden',
      background: colors.bg,
    }}>
      {/* In-lesson navigation: the track ("epic") + its lessons + the current
          lesson outline. Only shown while a lesson is open — the track
          selector is its own navigator. */}
      {lesson && (
        <LessonNavSidebar collapsed={navCollapsed} onToggleCollapsed={toggleNav} />
      )}

      {/* Content area */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {lesson && currentTrackId
          ? <LessonView lesson={lesson} trackId={currentTrackId} />
          : <TrackSelector />
        }
      </div>

      {/* Dirac panel */}
      <DiracSidePanel />
    </div>
  );
}
