import { useLearnStore } from '../../stores/learnStore';
import { useThemeStore } from '../../stores/themeStore';
import { getLesson } from '../../data/lessons/tracks';
import { TrackSelector } from './TrackSelector';
import { LessonView } from './LessonView';
import { DiracSidePanel } from '../dirac/DiracSidePanel';

export function LearnModeView() {
  const colors = useThemeStore((s) => s.colors);
  const currentTrackId = useLearnStore((s) => s.currentTrackId);
  const currentLessonId = useLearnStore((s) => s.currentLessonId);

  const lesson = currentTrackId && currentLessonId
    ? getLesson(currentTrackId, currentLessonId)
    : null;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      overflow: 'hidden',
      background: colors.bg,
    }}>
      {/* Content area ~65% */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {lesson && currentTrackId
          ? <LessonView lesson={lesson} trackId={currentTrackId} />
          : <TrackSelector />
        }
      </div>

      {/* Dirac panel ~35% */}
      <DiracSidePanel />
    </div>
  );
}
