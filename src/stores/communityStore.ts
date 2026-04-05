import { create } from 'zustand';
import type { GalleryCircuit } from '../data/community/mockGallery';

interface CommunityState {
  circuits: GalleryCircuit[];
  searchQuery: string;
  selectedCategory: string | null;
  sortBy: 'recent' | 'popular' | 'featured';
  bookmarkedIds: string[];
  likedIds: string[];
  selectedCircuit: GalleryCircuit | null;
  setCircuits: (circuits: GalleryCircuit[]) => void;
  setSearch: (query: string) => void;
  setCategory: (cat: string | null) => void;
  setSortBy: (sort: 'recent' | 'popular' | 'featured') => void;
  toggleBookmark: (id: string) => void;
  toggleLike: (id: string) => void;
  selectCircuit: (circuit: GalleryCircuit | null) => void;
}

function loadArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistArray(key: string, arr: string[]) {
  localStorage.setItem(key, JSON.stringify(arr));
}

export const useCommunityStore = create<CommunityState>((set) => ({
  circuits: [],
  searchQuery: '',
  selectedCategory: null,
  sortBy: 'recent',
  bookmarkedIds: loadArray('nuclei-bookmarks'),
  likedIds: loadArray('nuclei-likes'),
  selectedCircuit: null,

  setCircuits: (circuits) => set({ circuits }),
  setSearch: (query) => set({ searchQuery: query }),
  setCategory: (cat) => set({ selectedCategory: cat }),
  setSortBy: (sort) => set({ sortBy: sort }),

  toggleBookmark: (id) =>
    set((s) => {
      const next = s.bookmarkedIds.includes(id)
        ? s.bookmarkedIds.filter((b) => b !== id)
        : [...s.bookmarkedIds, id];
      persistArray('nuclei-bookmarks', next);
      return { bookmarkedIds: next };
    }),

  toggleLike: (id) =>
    set((s) => {
      const next = s.likedIds.includes(id)
        ? s.likedIds.filter((l) => l !== id)
        : [...s.likedIds, id];
      persistArray('nuclei-likes', next);
      return { likedIds: next };
    }),

  selectCircuit: (circuit) => set({ selectedCircuit: circuit }),
}));
