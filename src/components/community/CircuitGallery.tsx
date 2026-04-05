import { useRef, type CSSProperties } from 'react';
import { Search } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useCommunityStore } from '../../stores/communityStore';
import { useEditorStore } from '../../stores/editorStore';
import { CircuitCard } from './CircuitCard';
import { CircuitDetail } from './CircuitDetail';

const CATEGORIES: { value: string | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'tutorial', label: 'Tutorials' },
  { value: 'algorithm', label: 'Algorithms' },
  { value: 'art', label: 'Art' },
  { value: 'challenge', label: 'Challenges' },
];

const SORTS: { value: 'recent' | 'popular' | 'featured'; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'popular', label: 'Popular' },
  { value: 'featured', label: 'Featured' },
];

export function CircuitGallery() {
  const colors = useThemeStore((s) => s.colors);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const circuits = useCommunityStore((s) => s.circuits);
  const searchQuery = useCommunityStore((s) => s.searchQuery);
  const selectedCategory = useCommunityStore((s) => s.selectedCategory);
  const sortBy = useCommunityStore((s) => s.sortBy);
  const likedIds = useCommunityStore((s) => s.likedIds);
  const bookmarkedIds = useCommunityStore((s) => s.bookmarkedIds);
  const selectedCircuit = useCommunityStore((s) => s.selectedCircuit);
  const setSearch = useCommunityStore((s) => s.setSearch);
  const setCategory = useCommunityStore((s) => s.setCategory);
  const setSortBy = useCommunityStore((s) => s.setSortBy);
  const toggleLike = useCommunityStore((s) => s.toggleLike);
  const toggleBookmark = useCommunityStore((s) => s.toggleBookmark);
  const selectCircuit = useCommunityStore((s) => s.selectCircuit);
  const setCode = useEditorStore((s) => s.setCode);

  // Filter and sort locally
  let filtered = [...circuits];
  if (selectedCategory) {
    filtered = filtered.filter((c) => c.category === selectedCategory);
  }
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        c.author.displayName.toLowerCase().includes(q)
    );
  }
  switch (sortBy) {
    case 'popular':
      filtered.sort((a, b) => b.likes - a.likes);
      break;
    case 'featured':
      filtered.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
      break;
    case 'recent':
    default:
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      break;
  }

  const pillBase: CSSProperties = {
    padding: '4px 10px',
    borderRadius: 12,
    border: 'none',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 500,
    fontFamily: "'Geist Sans', sans-serif",
    transition: 'background 0.15s, color 0.15s',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      {/* Search */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Search
          size={13}
          style={{
            position: 'absolute',
            left: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            color: colors.textDim,
            pointerEvents: 'none',
          }}
        />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search circuits..."
          value={searchQuery}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '7px 10px 7px 28px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: colors.bg,
            color: colors.text,
            fontSize: 12,
            fontFamily: "'Geist Sans', sans-serif",
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = colors.accent;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = colors.border;
          }}
        />
      </div>

      {/* Category pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flexShrink: 0 }}>
        {CATEGORIES.map((cat) => {
          const active = selectedCategory === cat.value;
          return (
            <button
              key={cat.label}
              onClick={() => setCategory(cat.value)}
              style={{
                ...pillBase,
                background: active ? colors.accent : colors.bg,
                color: active ? '#fff' : colors.textMuted,
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Sort */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: colors.textDim, fontFamily: "'Geist Sans', sans-serif" }}>
          Sort:
        </span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'recent' | 'popular' | 'featured')}
          style={{
            background: colors.bgElevated,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            padding: '3px 6px',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: "'Geist Sans', sans-serif",
            outline: 'none',
          }}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Grid */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 8,
          alignContent: 'start',
        }}
      >
        {filtered.map((circuit) => (
          <CircuitCard
            key={circuit.id}
            circuit={circuit}
            isLiked={likedIds.includes(circuit.id)}
            isBookmarked={bookmarkedIds.includes(circuit.id)}
            onLike={() => toggleLike(circuit.id)}
            onBookmark={() => toggleBookmark(circuit.id)}
            onClick={() => selectCircuit(circuit)}
          />
        ))}
        {filtered.length === 0 && (
          <div
            style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: 24,
              color: colors.textDim,
              fontSize: 12,
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            No circuits found
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedCircuit && (
        <CircuitDetail
          circuit={selectedCircuit}
          onClose={() => selectCircuit(null)}
          onOpenInEditor={() => {
            setCode(selectedCircuit.code);
            selectCircuit(null);
          }}
        />
      )}
    </div>
  );
}
