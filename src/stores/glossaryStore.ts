import { create } from 'zustand';
import { GLOSSARY_TERMS, type GlossaryTerm } from '../data/glossary';

interface GlossaryState {
  searchQuery: string;
  selectedTerm: GlossaryTerm | null;
  filteredTerms: GlossaryTerm[];
  selectedCategory: string;
  setSearch: (query: string) => void;
  selectTerm: (term: GlossaryTerm | null) => void;
  setCategory: (category: string) => void;
}

function filterTerms(query: string, category: string): GlossaryTerm[] {
  const q = query.toLowerCase().trim();
  return GLOSSARY_TERMS.filter((t) => {
    if (category !== 'all' && t.category !== category) return false;
    if (!q) return true;
    return (
      t.term.toLowerCase().includes(q) ||
      t.aliases.some((a) => a.toLowerCase().includes(q)) ||
      t.category.toLowerCase().includes(q)
    );
  });
}

export const useGlossaryStore = create<GlossaryState>((set) => ({
  searchQuery: '',
  selectedTerm: null,
  filteredTerms: filterTerms('', 'all'),
  selectedCategory: 'all',

  setSearch: (query) =>
    set((s) => ({
      searchQuery: query,
      filteredTerms: filterTerms(query, s.selectedCategory),
    })),

  selectTerm: (term) => set({ selectedTerm: term }),

  setCategory: (category) =>
    set((s) => ({
      selectedCategory: category,
      filteredTerms: filterTerms(s.searchQuery, category),
    })),
}));
