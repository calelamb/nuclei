import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  // Depth layers (PRD Sprint 6 + UI/UX Pro Max)
  bg: string;        // Layer 1: main panels
  bgPanel: string;   // Layer 0: deepest (status bar, sidebars)
  bgEditor: string;  // Layer 1: editor
  bgElevated: string; // Layer 2: dropdowns, modals, tooltips
  border: string;    // Layer 3: hover states, selected items
  // Text hierarchy
  text: string;        // Primary: headings, important
  textMuted: string;   // Secondary: descriptions, labels
  textDim: string;     // Tertiary: placeholders, disabled
  // Accents
  accent: string;
  accentLight: string;
  dirac: string;
  // Semantic colors (UI/UX Pro Max)
  success: string;
  warning: string;
  error: string;
  info: string;
  // Syntax
  comment: string;
  string: string;
  number: string;
  // Circuit
  gateSingle: string;
  gateMulti: string;
  gateMeasure: string;
  wire: string;
}

const DARK_THEME: ThemeColors = {
  bg: '#0F1B2D',
  bgPanel: '#080E18',
  bgEditor: '#0F1B2D',
  bgElevated: '#152238',
  border: '#1A2A42',
  text: '#E8ECF1',
  textMuted: '#94A3B8',
  textDim: '#475569',
  accent: '#00B4D8',
  accentLight: '#48CAE4',
  dirac: '#7B2D8E',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
  comment: '#6A737D',
  string: '#98C379',
  number: '#D19A66',
  gateSingle: '#00B4D8',
  gateMulti: '#1E3A5F',
  gateMeasure: '#6A737D',
  wire: '#3D5A80',
};

const LIGHT_THEME: ThemeColors = {
  bg: '#FFFFFF',
  bgPanel: '#F1F5F9',
  bgEditor: '#FAFBFC',
  bgElevated: '#F8FAFC',
  border: '#E2E8F0',
  text: '#1A1A2E',
  textMuted: '#64748B',
  textDim: '#94A3B8',
  accent: '#0891B2',
  accentLight: '#00B4D8',
  dirac: '#6B21A8',
  success: '#059669',
  warning: '#D97706',
  error: '#DC2626',
  info: '#2563EB',
  comment: '#6A737D',
  string: '#22863A',
  number: '#B76E00',
  gateSingle: '#0891B2',
  gateMulti: '#3B6EA5',
  gateMeasure: '#6A737D',
  wire: '#959DA5',
};

interface ThemeState {
  mode: ThemeMode;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'dark',
  colors: DARK_THEME,
  setMode: (mode) => set({ mode, colors: mode === 'dark' ? DARK_THEME : LIGHT_THEME }),
  toggle: () => set((s) => {
    const next = s.mode === 'dark' ? 'light' : 'dark';
    return { mode: next, colors: next === 'dark' ? DARK_THEME : LIGHT_THEME };
  }),
}));
