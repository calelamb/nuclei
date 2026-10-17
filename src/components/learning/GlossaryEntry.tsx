import type { GlossaryTerm } from '../../data/glossary';
import { activateOnKey } from '../../lib/a11y';
import './learnSidebar.css';

interface GlossaryEntryProps {
  term: GlossaryTerm;
  isSelected: boolean;
  onClick: () => void;
}

/** Purple is reserved for Dirac, so entanglement takes the informational blue. */
const CATEGORY_COLORS: Record<string, string> = {
  basics: 'var(--color-success)',
  gates: 'var(--color-accent-quantum)',
  entanglement: 'var(--color-info)',
  algorithms: 'var(--color-warning)',
  'error-correction': 'var(--color-danger)',
  hardware: 'var(--color-text-tertiary)',
};

function TagRow({ label, items }: { label: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="gloss-entry__tags">
      <span>{label}</span>
      {items.map((item) => <span key={item} className="gloss-entry__tag">{item}</span>)}
    </div>
  );
}

export function GlossaryEntry({ term, isSelected, onClick }: GlossaryEntryProps) {
  const catColor = CATEGORY_COLORS[term.category] ?? 'var(--color-text-tertiary)';

  return (
    <div className="gloss-entry" role="button" tabIndex={0} aria-expanded={isSelected} onClick={onClick} onKeyDown={activateOnKey(onClick)}>
      <div className="gloss-entry__head">
        <span className="gloss-entry__term">{term.term}</span>
        <span className="gloss-entry__cat" style={{ ['--cat-color' as string]: catColor }}>{term.category.replace('-', ' ')}</span>
      </div>
      <div className={isSelected ? 'gloss-entry__def gloss-entry__def--open' : 'gloss-entry__def'}>{term.plainEnglish}</div>

      {isSelected && (
        <>
          {term.mathDefinition && <div className="gloss-entry__math">{term.mathDefinition}</div>}
          {term.codeExample && <pre className="gloss-entry__code">{term.codeExample.code}</pre>}
          <TagRow label="Related:" items={term.relatedConcepts} />
          <TagRow label="Also:" items={term.aliases} />
        </>
      )}
    </div>
  );
}
