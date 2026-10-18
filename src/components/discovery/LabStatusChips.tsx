import { Circle } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useLabActivityStore } from '../../stores/labActivityStore';
import { useModeSwitchStore } from '../../stores/modeSwitchStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { isConjectureTestActive, useConjectureStore } from '../../stores/conjectureStore';
import { isTrainabilityJobActive, useTrainabilityStore } from '../../stores/trainabilityStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { NavView } from '../../stores/navigationStore';

/**
 * Status-bar chips for Quantum AI Lab work in flight (PRD 14 §3.3): a
 * Discovery Engine run (running or paused), a Trainability Lab job and a
 * Conjecture Engine test. Each
 * chip is a button that jumps to its view, switching to Research mode first.
 */
function useOpenLabView() {
  return (view: NavView) => {
    if (useWorkspaceStore.getState().mode !== 'research') useModeSwitchStore.getState().requestSwitch('research');
    useNavigationStore.getState().setActiveView(view);
  };
}

interface ChipProps {
  label: string;
  detail: string;
  title: string;
  tone: 'accent' | 'warning';
  live: boolean;
  onClick: () => void;
}

const TRUNCATE: React.CSSProperties = {
  maxWidth: 140,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  display: 'inline-block',
  verticalAlign: 'bottom',
};

function Chip({ label, detail, title, tone, live, onClick }: ChipProps) {
  const colors = useThemeStore((s) => s.colors);
  const color = tone === 'warning' ? colors.warning : colors.dirac;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, color, fontSize: 10, minWidth: 0,
        background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
        fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      <Circle size={5} fill={color} stroke="none" style={{ flexShrink: 0, ...(live ? { animation: 'nuclei-heartbeat 1.5s ease infinite' } : {}) }} />
      <span style={TRUNCATE}>{label}</span>
      <span style={{ flexShrink: 0 }}>{detail}</span>
    </button>
  );
}

export function LabStatusChips() {
  const discovery = useLabActivityStore((s) => s.discovery);
  const trainabilityActive = useTrainabilityStore((s) => isTrainabilityJobActive(s));
  const trainabilityName = useTrainabilityStore((s) => {
    const job = s.activeJobId ? s.jobs[s.activeJobId] : undefined;
    return job?.target.fileName ?? 'analysis';
  });
  const conjectureActive = useConjectureStore((s) => isConjectureTestActive(s));
  const open = useOpenLabView();

  return (
    <>
      {discovery && (
        <Chip
          label={discovery.name}
          detail={`: ${discovery.status === 'paused' ? 'paused · ' : ''}${discovery.evaluations}${discovery.maxEvaluations > 0 ? `/${discovery.maxEvaluations}` : ''} evals`}
          title={`Discovery Engine: ${discovery.name} is ${discovery.status} (${discovery.evaluations} evaluations). Open the Discovery Engine.`}
          tone={discovery.status === 'paused' ? 'warning' : 'accent'}
          live={discovery.status === 'running'}
          onClick={() => open('discovery')}
        />
      )}
      {trainabilityActive && (
        <Chip
          label={trainabilityName}
          detail=": analyzing"
          title={`Trainability Lab: analyzing ${trainabilityName}. Open the Trainability Lab.`}
          tone="accent"
          live
          onClick={() => open('trainability')}
        />
      )}
      {conjectureActive && (
        <Chip
          label="Conjecture test"
          detail=": running"
          title="Conjecture Engine: a held-out test is running. Open the Discovery Engine."
          tone="accent"
          live
          onClick={() => open('discovery')}
        />
      )}
    </>
  );
}
