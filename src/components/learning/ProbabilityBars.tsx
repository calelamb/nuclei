import './demo.css';

interface ProbabilityBarsProps {
  probabilities: Record<string, number>;
  /** Outcomes at or below this probability are not worth a row. */
  floor?: number;
}

const DEFAULT_FLOOR = 0.001;

/** Compact outcome bars for the lesson demo, most likely first. */
export function ProbabilityBars({ probabilities, floor = DEFAULT_FLOOR }: ProbabilityBarsProps) {
  const entries = Object.entries(probabilities)
    .filter(([, p]) => p > floor)
    .sort(([, a], [, b]) => b - a);

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
