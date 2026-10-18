import { Activity, Atom, Layers, LineChart, Mountain } from 'lucide-react';
import { LabErrorBoundary, LabSegmented, type LabSegmentedItem } from '../lab';
import { useTrainabilityStore } from '../../stores/trainabilityStore';
import type { TrainabilityJobRecord, TrainabilityTabId } from '../../types/trainability';
import { AnalysisPanel } from './AnalysisPanel';
import { analysisView } from './analysisState';
import { GradientsTab } from './tabs/GradientsTab';
import { ScalingTab } from './tabs/ScalingTab';
import { LieTab } from './tabs/LieTab';
import { EntanglementPanel, ExpressibilityPanel } from './tabs/DistributionsTab';
import { LandscapeTab } from './tabs/LandscapeTab';

const TAB_ITEMS: Array<LabSegmentedItem<TrainabilityTabId>> = [
  { id: 'gradients', label: 'Gradients', icon: Activity },
  { id: 'scaling', label: 'Scaling', icon: LineChart },
  { id: 'lie', label: 'Lie algebra', icon: Atom },
  { id: 'expressibility', label: 'Expressibility', icon: Layers },
  { id: 'landscape', label: 'Landscape', icon: Mountain },
];

const ID_PREFIX = 'trainability-tabs';

export function AnalysisTabs({ job }: { job: TrainabilityJobRecord | null }) {
  const activeTab = useTrainabilityStore((s) => s.activeTab);
  const setActiveTab = useTrainabilityStore((s) => s.setActiveTab);

  return (
    <div className="lab-stack" style={{ gap: 'var(--space-3)' }}>
      <LabSegmented items={TAB_ITEMS} value={activeTab} onChange={setActiveTab} label="Analyses" idPrefix={ID_PREFIX} />
      <div role="tabpanel" id={`${ID_PREFIX}-panel-${activeTab}`} aria-labelledby={`${ID_PREFIX}-tab-${activeTab}`} tabIndex={0}>
        {/* A malformed payload in one tab must not take the Lab (or the app) down:
            the boundary resets when the tab, job or its results change. */}
        <LabErrorBoundary label={`The ${TAB_ITEMS.find((t) => t.id === activeTab)?.label ?? 'analysis'} tab`} resetKeys={[activeTab, job?.id, job?.results]} compact>
        {activeTab === 'gradients' && (
          <AnalysisPanel view={analysisView(job, 'gradients')} title="Gradients" emptyBody="Run the analyses to see per-parameter gradient variance with confidence intervals.">
            {(data) => <GradientsTab data={data} />}
          </AnalysisPanel>
        )}
        {activeTab === 'scaling' && (
          <AnalysisPanel view={analysisView(job, 'scaling')} title="Scaling" emptyBody="Run a scaling study to see how gradient variance changes with qubit count, with an exponential fit and a verdict.">
            {(data) => <ScalingTab data={data} />}
          </AnalysisPanel>
        )}
        {activeTab === 'lie' && (
          <AnalysisPanel view={analysisView(job, 'lie')} title="Lie algebra" emptyBody="Compute the dynamical Lie algebra to compare its dimension with 4ⁿ − 1 and get a simulability verdict.">
            {(data) => <LieTab data={data} gradients={job?.results.gradients} />}
          </AnalysisPanel>
        )}
        {activeTab === 'expressibility' && (
          <div className="lab-stack" style={{ gap: 'var(--space-5)' }}>
            <AnalysisPanel view={analysisView(job, 'expressibility')} title="Expressibility" emptyBody="Run the analyses to compare the circuit's fidelity distribution with the Haar distribution.">
              {(data) => <ExpressibilityPanel data={data} />}
            </AnalysisPanel>
            <AnalysisPanel view={analysisView(job, 'entanglement')} title="Entangling capability" emptyBody="Run the analyses to measure Meyer–Wallach entanglement against the Haar mean.">
              {(data) => <EntanglementPanel data={data} />}
            </AnalysisPanel>
          </div>
        )}
        {activeTab === 'landscape' && (
          <AnalysisPanel view={analysisView(job, 'landscape')} title="Landscape" emptyBody="Run the analyses to slice the loss landscape along two random directions.">
            {(data) => <LandscapeTab data={data} />}
          </AnalysisPanel>
        )}
        </LabErrorBoundary>
      </div>
    </div>
  );
}
