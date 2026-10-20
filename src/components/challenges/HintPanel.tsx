import { useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { Button } from '../ui';
import './challenges.css';

interface HintPanelProps {
  hints: string[];
}

export function HintPanel({ hints }: HintPanelProps) {
  const [revealedCount, setRevealedCount] = useState(0);

  if (hints.length === 0) {
    return <span className="hints__empty">No hints available for this challenge.</span>;
  }

  const canRevealMore = revealedCount < hints.length;

  return (
    <div className="hints">
      {hints.slice(0, revealedCount).map((hint, i) => (
        <div key={i} className="hints__item">
          <span className="hints__num">{i + 1}</span>
          <span className="hints__text">{hint}</span>
        </div>
      ))}

      {canRevealMore ? (
        <Button className="hints__more" icon={<Lightbulb size={12} aria-hidden="true" />} onClick={() => setRevealedCount((c) => c + 1)}>
          Reveal Hint ({hints.length - revealedCount} remaining)
        </Button>
      ) : (
        <span className="hints__empty">All hints revealed.</span>
      )}
    </div>
  );
}
