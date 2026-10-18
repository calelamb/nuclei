import { useMemo } from 'react';
import { LabCard, LabEmptyState } from '../../lab';
import { buildTrajectory } from '../../../services/discovery/trajectory';
import type { RunView } from '../../../services/discovery/runView';
import { useCandidateList } from '../useCandidateList';
import { ChampionCard } from '../ChampionCard';
import { ParetoChart } from '../ParetoChart';
import { TrajectoryChart } from '../TrajectoryChart';

export function OverviewTab({ view, onOpen }: { view: RunView; onOpen: (id: string) => void }) {
  const list = useCandidateList(view);
  const trajectory = useMemo(() => buildTrajectory(list), [list]);
  const hasPoints = trajectory.points.length > 0;
  return (
    <div className="disc-tabpanel">
      <LabCard title="Fitness trajectory" subtitle="Best so far per island, with every candidate as a point">
        {hasPoints ? (
          <TrajectoryChart trajectory={trajectory} onSelect={onOpen} />
        ) : (
          <LabEmptyState compact title="Nothing evaluated yet" body="Candidates appear here as the search scores them." />
        )}
      </LabCard>
      <div className="disc-two-col">
        <LabCard title="Pareto front" subtitle="Archived candidates on the evaluator's first two objectives">
          <ParetoChart archive={view.run.archive} championId={view.run.champion_id} onSelect={onOpen} />
        </LabCard>
        <ChampionCard view={view} onOpen={onOpen} />
      </div>
    </div>
  );
}
