import { Clock } from 'lucide-react';
import type { CapstoneProject } from '../../data/capstoneProjects';
import { useThemeStore } from '../../stores/themeStore';

interface CapstoneCardProps {
  project: CapstoneProject;
  completedCount: number;
  onStart: () => void;
}

export function CapstoneCard({ project, completedCount, onStart }: CapstoneCardProps) {
  const colors = useThemeStore((s) => s.colors);
  const total = project.milestones.length;
  const isStarted = completedCount > 0;
  const diffColor = project.difficulty === 'advanced' ? colors.warning : colors.accent;

  return (
    <div style={{
      background: colors.bgElevated,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: 12,
      marginBottom: 8,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      {/* Title + difficulty */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: colors.text, fontSize: 14, fontWeight: 600, fontFamily: 'Geist Sans, Inter, sans-serif', flex: 1 }}>
          {project.title}
        </span>
        <span style={{
          fontSize: 9,
          fontFamily: 'Geist Sans, Inter, sans-serif',
          padding: '1px 6px',
          borderRadius: 10,
          background: diffColor + '22',
          color: diffColor,
          fontWeight: 600,
          textTransform: 'capitalize',
          flexShrink: 0,
        }}>
          {project.difficulty}
        </span>
      </div>

      {/* Description */}
      <div style={{
        color: colors.textMuted,
        fontSize: 12,
        fontFamily: 'Geist Sans, Inter, sans-serif',
        lineHeight: 1.4,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {project.description}
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: colors.textDim, fontSize: 11, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Clock size={10} />
          {project.estimatedWeeks} week{project.estimatedWeeks > 1 ? 's' : ''}
        </span>
        <span>
          {completedCount}/{total} milestones
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, borderRadius: 2, background: colors.border }}>
        <div style={{ width: `${(completedCount / total) * 100}%`, height: '100%', borderRadius: 2, background: colors.accent, transition: 'width 0.3s' }} />
      </div>

      {/* Start / Continue button */}
      <button
        onClick={onStart}
        style={{
          marginTop: 2,
          padding: '5px 12px',
          background: isStarted ? 'transparent' : colors.accent,
          color: isStarted ? colors.accent : '#fff',
          border: isStarted ? `1px solid ${colors.accent}` : 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'Geist Sans, Inter, sans-serif',
          alignSelf: 'flex-start',
        }}
      >
        {isStarted ? 'Continue' : 'Start Project'}
      </button>
    </div>
  );
}
