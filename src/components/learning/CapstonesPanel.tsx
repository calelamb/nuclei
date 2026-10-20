import { useCapstoneStore } from '../../stores/capstoneStore';
import { CAPSTONE_PROJECTS } from '../../data/capstoneProjects';
import { CapstoneCard } from './CapstoneCard';
import { CapstoneProjectView } from './CapstoneProject';
import './learnSidebar.css';

/** Capstone project list, or the active project when one is open. */
export function CapstonesPanel() {
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
