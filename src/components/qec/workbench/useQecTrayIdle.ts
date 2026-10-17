import { useProjectStore } from '../../../stores/projectStore';
import { useQecJobStore } from '../../../stores/qecJobStore';

/** True when the jobs tray has nothing to show (no job, no import in progress),
 * so it can shrink to a status bar instead of reserving a quarter of the window. */
export function useQecTrayIdle(): boolean {
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const jobs = useQecJobStore((state) => state.jobs);
  const importSource = useQecJobStore((state) => state.importSource);
  const jobProjectRoot = useQecJobStore((state) => state.projectRoot);
  const importing = jobProjectRoot === projectRoot && importSource !== null;
  const hasJobs = Object.values(jobs).some((job) => job.projectRoot === projectRoot);
  return !importing && !hasJobs;
}
