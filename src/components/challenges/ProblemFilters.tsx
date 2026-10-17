import { Search } from 'lucide-react';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { SegmentedControl, type SegmentedOption } from '../ui';
import type { ChallengeDifficulty, ChallengeCategory } from '../../types/challenge';
import './challenges.css';

type StatusFilter = 'all' | 'not_started' | 'attempted' | 'solved';

const DIFFICULTIES: ReadonlyArray<SegmentedOption<'all' | ChallengeDifficulty>> = [
  { value: 'all', label: 'All' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

const CATEGORIES: ReadonlyArray<SegmentedOption<'all' | ChallengeCategory>> = [
  { value: 'all', label: 'All' },
  { value: 'state-preparation', label: 'State Prep' },
  { value: 'algorithms', label: 'Algorithms' },
  { value: 'optimization', label: 'Optimization' },
  { value: 'protocols', label: 'Protocols' },
];

const STATUS_OPTIONS: ReadonlyArray<SegmentedOption<StatusFilter>> = [
  { value: 'all', label: 'All' },
  { value: 'not_started', label: 'Not Started' },
  { value: 'attempted', label: 'Attempted' },
  { value: 'solved', label: 'Solved' },
];

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pfilters__group">
      <span className="pfilters__label">{label}</span>
      {children}
    </div>
  );
}

export function ProblemFilters() {
  const difficultyFilter = useChallengeModeStore((s) => s.difficultyFilter);
  const categoryFilter = useChallengeModeStore((s) => s.categoryFilter);
  const statusFilter = useChallengeModeStore((s) => s.statusFilter);
  const searchQuery = useChallengeModeStore((s) => s.searchQuery);
  const setDifficultyFilter = useChallengeModeStore((s) => s.setDifficultyFilter);
  const setCategoryFilter = useChallengeModeStore((s) => s.setCategoryFilter);
  const setStatusFilter = useChallengeModeStore((s) => s.setStatusFilter);
  const setSearchQuery = useChallengeModeStore((s) => s.setSearchQuery);

  return (
    <div className="pfilters">
      <label className="pfilters__search nuclei-field-group">
        <Search size={14} aria-hidden="true" />
        <input
          className="pfilters__input nuclei-bare-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search challenges..."
          aria-label="Search challenges"
        />
      </label>

      <div className="pfilters__row">
        <FilterGroup label="Difficulty">
          <SegmentedControl
            aria-label="Difficulty"
            value={difficultyFilter ?? 'all'}
            options={DIFFICULTIES}
            onChange={(next) => setDifficultyFilter(next === 'all' ? null : next)}
          />
        </FilterGroup>
        <span className="pfilters__sep" aria-hidden="true" />
        <FilterGroup label="Category">
          <SegmentedControl
            aria-label="Category"
            value={categoryFilter ?? 'all'}
            options={CATEGORIES}
            onChange={(next) => setCategoryFilter(next === 'all' ? null : next)}
          />
        </FilterGroup>
        <span className="pfilters__sep" aria-hidden="true" />
        <FilterGroup label="Status">
          <SegmentedControl aria-label="Status" value={statusFilter} options={STATUS_OPTIONS} onChange={setStatusFilter} />
        </FilterGroup>
      </div>
    </div>
  );
}
