import type { WorkspaceMode } from '../../stores/workspaceStore';

export interface TourStep {
  target: string;
  title: string;
  body: string;
  placement: 'right' | 'above';
}

export interface TourContext {
  /** Pyodide web build: no folder projects, no sweeps. */
  web: boolean;
  hasProject: boolean;
  mode: WorkspaceMode;
}

function filesBody({ web, hasProject }: TourContext): string {
  if (web) return 'Folder projects need the desktop app; single files work here.';
  if (hasProject) return 'Your project files live here. Open a file to edit it, or use + to add one.';
  return 'Your project files live here. Open a folder to bring your code into the workspace.';
}

/** Steps for the Research tour, adapted to platform, project and current mode. */
export function researchTourSteps(ctx: TourContext): TourStep[] {
  const second: TourStep = ctx.web
    ? {
        target: 'activity-qec',
        title: 'QEC Workbench',
        body: 'Drop a sinter CSV to plot logical error rate against physical error rate, right in the browser.',
        placement: 'right',
      }
    : {
        target: 'activity-experiments',
        title: 'Experiments',
        body: 'Declare parameter sweeps and QEC campaigns, run them, and compare results — all as files in your project.',
        placement: 'right',
      };
  return [
    { target: 'activity-files', title: 'Explorer', body: filesBody(ctx), placement: 'right' },
    second,
    {
      target: 'mode-chip',
      title: ctx.mode === 'research' ? "You're in Research mode" : 'Switch between Learn and Research',
      body: 'This chip always shows your mode and switches it. Switching never stops a running job — it only changes what you see.',
      placement: 'above',
    },
  ];
}
