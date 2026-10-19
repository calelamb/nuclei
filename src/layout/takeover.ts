import { useLearnStore } from '../stores/learnStore';
import { useChallengeModeStore } from '../stores/challengeModeStore';
import { useNavigationStore, type NavView } from '../stores/navigationStore';
import { useWorkspaceStore, type WorkspaceMode } from '../stores/workspaceStore';
import { useExperimentUiStore } from '../stores/experimentUiStore';

export interface TakeoverFacts {
  isLearnMode: boolean;
  isChallengeMode: boolean;
  workspaceMode: WorkspaceMode;
  activeView: NavView | null;
  experimentSelected: boolean;
}

/**
 * True while a full-width view (a lesson, a challenge, the QEC Workbench, the transpiler or an
 * experiment's runs) owns the main area. Editor-only chrome (circuit stats, the layout preset)
 * means nothing there.
 */
export function isMainAreaTakeover(f: TakeoverFacts): boolean {
  if (f.isLearnMode || f.isChallengeMode) return true;
  if (f.workspaceMode !== 'research') return false;
  return f.activeView === 'qec' || f.activeView === 'transpiler' || (f.activeView === 'experiments' && f.experimentSelected);
}

export type MainTakeover = 'lesson' | 'challenge' | 'qec' | 'transpiler' | 'experiment';

/** Which full-width view owns the main area, or null for the plain editor. Same rules as isMainAreaTakeover. */
export function mainTakeoverKind(f: TakeoverFacts): MainTakeover | null {
  if (f.isChallengeMode) return 'challenge';
  if (f.isLearnMode) return 'lesson';
  if (!isMainAreaTakeover(f)) return null;
  if (f.activeView === 'qec') return 'qec';
  if (f.activeView === 'transpiler') return 'transpiler';
  return 'experiment';
}

export interface SidebarFacts {
  /** A lesson or challenge owns the whole area (Settings may still open beside it). */
  fullViewOwnsArea: boolean;
  activeView: NavView | null;
  /** False at Beginner, where the Explorer sidebar is hidden. */
  explorerSidebar: boolean;
  isWeb: boolean;
}

/**
 * Whether the rail's active view gets a sidebar. On the web the QEC Workbench has no project
 * folder and the Transpiler Explorer cannot run, so their sidebars would be 240px columns holding
 * one sentence; the main view says it instead and keeps the full width.
 */
export function isSidebarShown(f: SidebarFacts): boolean {
  if (f.fullViewOwnsArea || f.activeView === null) return false;
  if (f.activeView === 'files' && !f.explorerSidebar) return false;
  // The web build has no project folder (QEC) and no transpiler engine: their sidebars would hold one sentence.
  if ((f.activeView === 'qec' || f.activeView === 'transpiler') && f.isWeb) return false;
  return true;
}

export function useMainTakeoverKind(): MainTakeover | null {
  const isLearnMode = useLearnStore((s) => s.isLearnMode);
  const isChallengeMode = useChallengeModeStore((s) => s.isChallengeMode);
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const activeView = useNavigationStore((s) => s.activeView);
  const experimentSelected = useExperimentUiStore((s) => s.selectedExperimentFileName !== null);
  return mainTakeoverKind({ isLearnMode, isChallengeMode, workspaceMode, activeView, experimentSelected });
}

export function useMainAreaTakeover(): boolean {
  const isLearnMode = useLearnStore((s) => s.isLearnMode);
  const isChallengeMode = useChallengeModeStore((s) => s.isChallengeMode);
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const activeView = useNavigationStore((s) => s.activeView);
  const experimentSelected = useExperimentUiStore((s) => s.selectedExperimentFileName !== null);
  return isMainAreaTakeover({ isLearnMode, isChallengeMode, workspaceMode, activeView, experimentSelected });
}
