import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  bg: string;
  bgPanel: string;
  bgEditor: string;
  border: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  accentLight: string;
  dirac: string;
  comment: string;
  string: string;
  number: string;
  error: string;
  gateSingle: string;
  gateMulti: string;
  gateMeasure: string;
  wire: string;
}

const DARK_THEME: ThemeColors = {
  bg: '#0F1B2D',
  bgPanel: '#0A1220',
  bgEditor: '#0F1B2D',
  border: '#1A2A42',
  text: '#E0E0E0',
  textMuted: '#3D5A80',
  textDim: '#6A737D',
  accent: '#00B4D8',
  accentLight: '#48CAE4',
  dirac: '#7B2D8E',
  comment: '#6A737D',
  string: '#98C379',
  number: '#D19A66',
  error: '#E06C75',
  gateSingle: '#00B4D8',
  gateMulti: '#1E3A5F',
  gateMeasure: '#6A737D',
  wire: '#3D5A80',
};

const LIGHT_THEME: ThemeColors = {
  bg: '#FFFFFF',
  bgPanel: '#FAFBFC',
  bgEditor: '#FAFBFC',
  border: '#E1E4E8',
  text: '#1A1A2E',
  textMuted: '#6A737D',
  textDim: '#959DA5',
  accent: '#0096B7',
  accentLight: '#00B4D8',
  dirac: '#6B21A8',
  comment: '#6A737D',
  string: '#22863A',
  number: '#B76E00',
  error: '#D73A49',
  gateSingle: '#0096B7',
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
