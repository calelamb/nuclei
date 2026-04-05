import { Search } from 'lucide-react';
import { useGlossaryStore } from '../../stores/glossaryStore';
import { useThemeStore } from '../../stores/themeStore';
import { GlossaryEntry } from './GlossaryEntry';

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'basics', label: 'Basics' },
  { key: 'gates', label: 'Gates' },
  { key: 'entanglement', label: 'Entanglement' },
  { key: 'algorithms', label: 'Algorithms' },
  { key: 'error-correction', label: 'Error Correction' },
  { key: 'hardware', label: 'Hardware' },
];

export function Glossary() {
  const colors = useThemeStore((s) => s.colors);
  const { searchQuery, selectedTerm, filteredTerms, selectedCategory, setSearch, selectTerm, setCategory } = useGlossaryStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Search input */}
      <div style={{ padding: '8px 12px', flexShrink: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: colors.bgPanel,
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          padding: '4px 8px',
        }}>
          <Search size={12} color={colors.textDim} />
          <input
            type="text"
            placeholder="Search terms..."
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: colors.text,
              fontSize: 12,
              fontFamily: 'Geist Sans, Inter, sans-serif',
            }}
          />
        </div>
      </div>

      {/* Category pills */}
      <div style={{ padding: '0 12px 8px', display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setCategory(cat.key)}
            style={{
              padding: '2px 8px',
              fontSize: 10,
              fontFamily: 'Geist Sans, Inter, sans-serif',
              fontWeight: selectedCategory === cat.key ? 600 : 400,
              background: selectedCategory === cat.key ? colors.accent + '22' : 'transparent',
              color: selectedCategory === cat.key ? colors.accent : colors.textMuted,
              border: `1px solid ${selectedCategory === cat.key ? colors.accent + '44' : colors.border}`,
              borderRadius: 10,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Term list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
        {filteredTerms.length === 0 ? (
          <div style={{ color: colors.textDim, fontSize: 12, fontFamily: 'Geist Sans, Inter, sans-serif', textAlign: 'center', paddingTop: 24 }}>
            No terms found.
          </div>
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
