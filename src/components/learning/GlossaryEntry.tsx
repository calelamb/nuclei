import type { GlossaryTerm } from '../../data/glossary';
import { useThemeStore } from '../../stores/themeStore';

interface GlossaryEntryProps {
  term: GlossaryTerm;
  isSelected: boolean;
  onClick: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  basics: '#10B981',
  gates: '#00B4D8',
  entanglement: '#7B2D8E',
  algorithms: '#F59E0B',
  'error-correction': '#EF4444',
  hardware: '#6A737D',
};

export function GlossaryEntry({ term, isSelected, onClick }: GlossaryEntryProps) {
  const colors = useThemeStore((s) => s.colors);
  const catColor = CATEGORY_COLORS[term.category] ?? colors.textDim;

  const displayDef = isSelected
    ? term.plainEnglish
    : term.plainEnglish.length > 100
      ? term.plainEnglish.slice(0, 100) + '...'
      : term.plainEnglish;

  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 10px',
        background: colors.bgElevated,
        border: `1px solid ${isSelected ? colors.accent : colors.border}`,
        borderRadius: 6,
        cursor: 'pointer',
        marginBottom: 6,
        transition: 'border-color 0.15s',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ color: colors.text, fontSize: 13, fontWeight: 600, fontFamily: 'Geist Sans, Inter, sans-serif' }}>
          {term.term}
        </span>
        <span style={{
          fontSize: 9,
          fontFamily: 'Geist Sans, Inter, sans-serif',
          padding: '1px 5px',
          borderRadius: 3,
          background: catColor + '22',
          color: catColor,
          fontWeight: 600,
          textTransform: 'capitalize',
        }}>
          {term.category.replace('-', ' ')}
        </span>
      </div>

      {/* Plain English definition */}
      <div style={{
        color: colors.textMuted,
        fontSize: 12,
        fontFamily: 'Geist Sans, Inter, sans-serif',
        lineHeight: 1.5,
        marginBottom: isSelected ? 8 : 0,
      }}>
        {displayDef}
      </div>

      {/* Expanded content */}
      {isSelected && (
        <>
          {/* Math definition */}
          {term.mathDefinition && (
            <div style={{
              color: colors.textDim,
              fontSize: 12,
              fontFamily: 'JetBrains Mono, monospace',
              padding: '6px 8px',
              background: colors.bgPanel,
              borderRadius: 4,
              marginBottom: 6,
              lineHeight: 1.5,
            }}>
              {term.mathDefinition}
            </div>
          )}

          {/* Code example */}
          {term.codeExample && (
            <pre style={{
              color: colors.text,
              fontSize: 11,
              fontFamily: 'JetBrains Mono, monospace',
              padding: '6px 8px',
              background: colors.bgEditor,
              borderRadius: 4,
              marginBottom: 6,
              lineHeight: 1.5,
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              margin: '0 0 6px 0',
            }}>
              {term.codeExample.code}
            </pre>
          )}

          {/* Related concepts */}
          {term.relatedConcepts.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ color: colors.textDim, fontSize: 10, fontFamily: 'Geist Sans, Inter, sans-serif', marginRight: 2 }}>
                Related:
              </span>
              {term.relatedConcepts.map((rc) => (
                <span
                  key={rc}
                  style={{
                    fontSize: 10,
                    fontFamily: 'Geist Sans, Inter, sans-serif',
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: colors.accent + '18',
                    color: colors.accent,
                  }}
                >
                  {rc}
                </span>
              ))}
            </div>
          )}

          {/* Aliases */}
          {term.aliases.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ color: colors.textDim, fontSize: 10, fontFamily: 'Geist Sans, Inter, sans-serif', marginRight: 2 }}>
                Also:
              </span>
              {term.aliases.map((a) => (
                <span
                  key={a}
                  style={{
                    fontSize: 9,
                    fontFamily: 'Geist Sans, Inter, sans-serif',
                    padding: '1px 4px',
                    borderRadius: 2,
                    background: colors.border,
                    color: colors.textMuted,
                  }}
                >
                  {a}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
