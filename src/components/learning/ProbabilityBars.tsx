import './demo.css';

interface ProbabilityBarsProps {
  probabilities: Record<string, number>;
  /** Outcomes at or below this probability are not worth a row. */
  floor?: number;
  /** Outcomes always drawn, even at 0%, so a chart can show what was expected but never measured. */
  pinned?: ReadonlyArray<string>;
}

const DEFAULT_FLOOR = 0.001;

/** Compact outcome bars for the lesson demo, in basis-state order so repeated sampled runs stay comparable. */
export function ProbabilityBars({ probabilities, floor = DEFAULT_FLOOR, pinned = [] }: ProbabilityBarsProps) {
  const withPinned = { ...Object.fromEntries(pinned.map((k) => [k, 0])), ...probabilities };
  const entries = Object.entries(withPinned)
    .filter(([state, p]) => p > floor || pinned.includes(state))
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) return null;

  return (
    <div className="prob-bars" role="list" aria-label="Outcome probabilities">
      {entries.map(([state, prob]) => (
        <div key={state} className="prob-bars__row" role="listitem">
          <span className="prob-bars__state">|{state}{'⟩'}</span>
          <div className="prob-bars__track">
            <div className="prob-bars__fill" style={{ width: `${prob * 100}%` }} />
          </div>
          <span className="prob-bars__pct">{(prob * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}
