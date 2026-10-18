import { Search } from 'lucide-react';
import { useGlossaryStore } from '../../stores/glossaryStore';
import { GlossaryEntry } from './GlossaryEntry';
import './learnSidebar.css';
import './glossary.css';

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'basics', label: 'Basics' },
  { key: 'gates', label: 'Gates' },
  { key: 'entanglement', label: 'Entanglement' },
  { key: 'algorithms', label: 'Algorithms' },
  { key: 'error-correction', label: 'Error correction' },
  { key: 'hardware', label: 'Hardware' },
];

interface GlossaryProps {
  /** `page` flows at natural height inside the chooser; `compact` fills the sidebar and scrolls its own list. */
  variant?: 'compact' | 'page';
}

export function Glossary({ variant = 'compact' }: GlossaryProps) {
  const { searchQuery, selectedTerm, filteredTerms, selectedCategory, setSearch, selectTerm, setCategory } = useGlossaryStore();

  return (
    <div className={variant === 'page' ? 'gloss gloss--page' : 'gloss'}>
      <div className="gloss__head">
      <div className="gloss__search">
        <label className="gloss__field nuclei-field-group">
          <Search size={12} aria-hidden="true" />
          <input
            type="text"
            placeholder="Search terms..."
            aria-label="Search glossary terms"
            className="gloss__input nuclei-bare-input"
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <div className="gloss__cats" role="group" aria-label="Filter by category">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            className="gloss__cat"
            aria-pressed={selectedCategory === cat.key}
            onClick={() => setCategory(cat.key)}
          >
            {cat.label}
          </button>
        ))}
      </div>
      </div>

      <div className="gloss__list">
        {filteredTerms.length === 0 ? (
          <div className="gloss__empty">No terms found.</div>
        ) : (
          filteredTerms.map((term) => (
            <GlossaryEntry
              key={term.id}
              term={term}
              isSelected={selectedTerm?.id === term.id}
              onClick={() => selectTerm(selectedTerm?.id === term.id ? null : term)}
            />
          ))
        )}
      </div>
    </div>
  );
}
