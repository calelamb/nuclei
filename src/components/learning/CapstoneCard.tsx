import { Clock } from 'lucide-react';
import type { CapstoneProject } from '../../data/capstoneProjects';
import { Badge, Button } from '../ui';
import { levelTone } from './levelTone';
import './learnSidebar.css';

interface CapstoneCardProps {
  project: CapstoneProject;
  completedCount: number;
  onStart: () => void;
}

export function CapstoneCard({ project, completedCount, onStart }: CapstoneCardProps) {
  const total = project.milestones.length;
  const isStarted = completedCount > 0;

  return (
    <div className="cap-card">
      <div className="cap-card__title">{project.title}</div>
      <div className="cap-card__desc">{project.description}</div>
      <div className="cap-card__meta">
        <span><Clock size={12} aria-hidden="true" />{project.estimatedWeeks} week{project.estimatedWeeks > 1 ? 's' : ''}</span>
        <span>{completedCount}/{total} milestones</span>
        <Badge tone={levelTone(project.difficulty)} style={{ textTransform: 'capitalize' }}>{project.difficulty}</Badge>
      </div>
      <div className="cap-card__bar" role="progressbar" aria-label={`${project.title} progress`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={completedCount}>
        <div className="cap-card__bar-fill" style={{ width: `${total ? (completedCount / total) * 100 : 0}%` }} />
      </div>
      <Button size="sm" variant={isStarted ? 'secondary' : 'primary'} className="cap-card__action" onClick={onStart}>
        {isStarted ? 'Continue' : 'Start project'}
      </Button>
    </div>
  );
}
