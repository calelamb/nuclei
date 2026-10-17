import { Clock } from 'lucide-react';
import type { CapstoneProject } from '../../data/capstoneProjects';
import { Button } from '../ui';
import './learnSidebar.css';

interface CapstoneCardProps {
  project: CapstoneProject;
  completedCount: number;
  onStart: () => void;
}

export function CapstoneCard({ project, completedCount, onStart }: CapstoneCardProps) {
  const total = project.milestones.length;
  const isStarted = completedCount > 0;
  const levelColor = project.difficulty === 'advanced' ? 'var(--color-warning)' : 'var(--color-accent-quantum)';

  return (
    <div className="cap-card">
      <div className="cap-card__row">
        <span className="cap-card__title">{project.title}</span>
        <span className="cap-card__level" style={{ ['--level-color' as string]: levelColor }}>{project.difficulty}</span>
      </div>
      <div className="cap-card__desc">{project.description}</div>
      <div className="cap-card__meta">
        <span><Clock size={12} aria-hidden="true" />{project.estimatedWeeks} week{project.estimatedWeeks > 1 ? 's' : ''}</span>
        <span>{completedCount}/{total} milestones</span>
      </div>
      <div className="cap-card__bar" role="progressbar" aria-label={`${project.title} progress`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={completedCount}>
        <div className="cap-card__bar-fill" style={{ width: `${total ? (completedCount / total) * 100 : 0}%` }} />
      </div>
      <Button size="sm" variant={isStarted ? 'secondary' : 'primary'} className="cap-card__action" onClick={onStart}>
        {isStarted ? 'Continue' : 'Start Project'}
      </Button>
    </div>
  );
}
