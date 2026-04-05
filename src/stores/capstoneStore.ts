import { create } from 'zustand';
import type { CapstoneProject } from '../data/capstoneProjects';

interface CapstoneState {
  activeProject: CapstoneProject | null;
  activeMilestoneIndex: number;
  completedMilestones: Record<string, string[]>; // projectId -> completed milestoneIds
  startProject: (project: CapstoneProject) => void;
  advanceMilestone: () => void;
  completeMilestone: () => void;
  exitProject: () => void;
}

function loadCompleted(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem('nuclei-capstones');
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function persistCompleted(completed: Record<string, string[]>) {
  try {
    localStorage.setItem('nuclei-capstones', JSON.stringify(completed));
  } catch {
    // ignore
  }
}

export const useCapstoneStore = create<CapstoneState>((set, get) => ({
  activeProject: null,
  activeMilestoneIndex: 0,
  completedMilestones: loadCompleted(),

  startProject: (project) => {
    const completed = get().completedMilestones[project.id] ?? [];
    // Resume from first incomplete milestone
    const startIdx = Math.max(
      0,
      project.milestones.findIndex((m) => !completed.includes(m.id))
    );
    set({ activeProject: project, activeMilestoneIndex: startIdx === -1 ? 0 : startIdx });
  },

  advanceMilestone: () => {
    const { activeProject, activeMilestoneIndex } = get();
    if (!activeProject) return;
    if (activeMilestoneIndex < activeProject.milestones.length - 1) {
      set({ activeMilestoneIndex: activeMilestoneIndex + 1 });
    }
  },

  completeMilestone: () => {
    const { activeProject, activeMilestoneIndex, completedMilestones } = get();
    if (!activeProject) return;
    const milestone = activeProject.milestones[activeMilestoneIndex];
    if (!milestone) return;

    const projectCompleted = completedMilestones[activeProject.id] ?? [];
    if (projectCompleted.includes(milestone.id)) return;

    const updated = {
      ...completedMilestones,
      [activeProject.id]: [...projectCompleted, milestone.id],
    };
    persistCompleted(updated);

    const nextIndex = activeMilestoneIndex < activeProject.milestones.length - 1
      ? activeMilestoneIndex + 1
      : activeMilestoneIndex;

    set({ completedMilestones: updated, activeMilestoneIndex: nextIndex });
  },

  exitProject: () => set({ activeProject: null, activeMilestoneIndex: 0 }),
}));
