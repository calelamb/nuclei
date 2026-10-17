import { useMemo } from 'react';
import { CONCEPT_GRAPH } from '../../data/conceptMap';
import { useStudentStore } from '../../stores/studentStore';

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  basics: 'Basics',
  gates: 'Gates',
  entanglement: 'Entanglement',
  algorithms: 'Algorithms',
  'error-correction': 'Error Correction',
  hardware: 'Hardware',
};

interface CategoryRow {
  readonly key: string;
  readonly label: string;
  readonly total: number;
  readonly mastered: number;
  readonly inProgress: number;
}

/**
 * The rail is too narrow for the 860-unit concept graph without shrinking its
 * labels to unreadable sizes, so it shows progress per category instead; the
 * "Open full map" button next to it opens the real graph.
 */
export function ConceptSummary() {
  const mastered = useStudentStore((s) => s.model.conceptsMastered);
  const struggling = useStudentStore((s) => s.model.conceptsStruggling);

  const rows = useMemo<CategoryRow[]>(() => {
    return Object.entries(CATEGORY_LABELS).map(([key, label]) => {
      const nodes = CONCEPT_GRAPH.nodes.filter((n) => n.category === key);
      return {
        key,
        label,
        total: nodes.length,
        mastered: nodes.filter((n) => mastered.includes(n.id)).length,
        inProgress: nodes.filter((n) => struggling.includes(n.id)).length,
      };
    }).filter((row) => row.total > 0);
  }, [mastered, struggling]);

  return (
    <ul className="csum" aria-label="Concept progress by category">
      {rows.map((row) => (
        <li key={row.key} className="csum__row">
          <div className="csum__head">
            <span className="csum__label">{row.label}</span>
            <span className="csum__count">{row.mastered}/{row.total}</span>
          </div>
          <div
            className="csum__bar"
            role="progressbar"
            aria-label={`${row.label} concepts mastered`}
            aria-valuemin={0}
            aria-valuemax={row.total}
            aria-valuenow={row.mastered}
          >
            <span className="csum__fill" style={{ width: `${(row.mastered / row.total) * 100}%` }} />
            <span className="csum__fill csum__fill--progress" style={{ width: `${(row.inProgress / row.total) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
