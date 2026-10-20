import type { GlossaryTerm } from '../../data/glossary';
import { activateOnKey } from '../../lib/a11y';
import { Badge } from '../ui';
import './learnSidebar.css';

interface GlossaryEntryProps {
  term: GlossaryTerm;
  isSelected: boolean;
  onClick: () => void;
}

function TagRow({ label, items }: { label: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="gloss-entry__tags">
      <span>{label}</span>
      {items.map((item) => <span key={item} className="gloss-entry__tag">{item}</span>)}
    </div>
  );
}

function categoryLabel(category: string): string {
  const spaced = category.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function GlossaryEntry({ term, isSelected, onClick }: GlossaryEntryProps) {
  return (
    <div className="gloss-entry" role="button" tabIndex={0} aria-expanded={isSelected} onClick={onClick} onKeyDown={activateOnKey(onClick)}>
      <div className="gloss-entry__head">
        <span className="gloss-entry__term">{term.term}</span>
        {/* Categories are labels, not statuses: one neutral tone, never success/warning/danger. */}
        <Badge tone="neutral">{categoryLabel(term.category)}</Badge>
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
