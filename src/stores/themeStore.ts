import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light';

export interface ThemeShadows {
  sm: string;    // Subtle lift: buttons, inputs
  md: string;    // Cards, dropdowns, panels
  lg: string;    // Modals, command palette
  glow: string;  // Accent glow for focused/active elements
}

export interface ThemeColors {
  // Depth layers (creates visual hierarchy without borders)
  bg: string;          // Layer 1: main panels (editor, circuit)
  bgPanel: string;     // Layer 0: deepest (status bar, sidebars, app edges)
  bgEditor: string;    // Layer 1: editor background
  bgElevated: string;  // Layer 2: dropdowns, modals, tooltips
  border: string;      // Nearly invisible — panels distinguished by shade, not lines
  borderStrong: string; // Visible divider for when you need a real line
  // Text hierarchy
  text: string;        // Primary: headings, important text
  textMuted: string;   // Secondary: descriptions, labels
  textDim: string;     // Tertiary: placeholders, disabled
  // Accents
  accent: string;      // Teal — interactive, quantum elements
  accentLight: string;
  dirac: string;       // Purple — Dirac/AI elements
  // Semantic colors
  success: string;     // Green — simulation complete, exercise passed
  warning: string;     // Amber — deprecated gate, performance concern
  error: string;       // Red — compile error, simulation fail
  info: string;        // Blue — Dirac tip, learning callout
  // Syntax highlighting
  comment: string;
  string: string;
  number: string;
  // Circuit
  gateSingle: string;
  gateMulti: string;
  gateMeasure: string;
  wire: string;
}

const DARK_SHADOWS: ThemeShadows = {
  sm: '0 1px 2px rgba(0,0,0,0.3)',
  md: '0 4px 12px rgba(0,0,0,0.4)',
  lg: '0 8px 24px rgba(0,0,0,0.5)',
  glow: '0 0 20px rgba(0,180,216,0.15)',
};

const LIGHT_SHADOWS: ThemeShadows = {
  sm: '0 1px 3px rgba(0,0,0,0.08)',
  md: '0 4px 12px rgba(0,0,0,0.1)',
  lg: '0 8px 24px rgba(0,0,0,0.15)',
  glow: '0 0 20px rgba(8,145,178,0.12)',
};

const DARK_THEME: ThemeColors = {
  bg: '#0F1B2D',
  bgPanel: '#080E18',
  bgEditor: '#0F1B2D',
  bgElevated: '#152238',
  border: 'rgba(255,255,255,0.06)',
  borderStrong: '#1A2A42',
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
  border: 'rgba(0,0,0,0.06)',
  borderStrong: '#E2E8F0',
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
  shadow: ThemeShadows;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'dark',
  colors: DARK_THEME,
  shadow: DARK_SHADOWS,
  setMode: (mode) => set({
    mode,
    colors: mode === 'dark' ? DARK_THEME : LIGHT_THEME,
    shadow: mode === 'dark' ? DARK_SHADOWS : LIGHT_SHADOWS,
  }),
  toggle: () => set((s) => {
    const next = s.mode === 'dark' ? 'light' : 'dark';
    return {
      mode: next,
      colors: next === 'dark' ? DARK_THEME : LIGHT_THEME,
      shadow: next === 'dark' ? DARK_SHADOWS : LIGHT_SHADOWS,
    };
  }),
}));
