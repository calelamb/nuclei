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

export function useMainAreaTakeover(): boolean {
  const isLearnMode = useLearnStore((s) => s.isLearnMode);
  const isChallengeMode = useChallengeModeStore((s) => s.isChallengeMode);
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const activeView = useNavigationStore((s) => s.activeView);
  const experimentSelected = useExperimentUiStore((s) => s.selectedExperimentFileName !== null);
  return isMainAreaTakeover({ isLearnMode, isChallengeMode, workspaceMode, activeView, experimentSelected });
}
