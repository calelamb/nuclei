import { create } from 'zustand';
import {
  DARK_COLORS, LIGHT_COLORS,
  DARK_SHADOWS, LIGHT_SHADOWS,
  type ColorTokens, type ShadowTokens, type ThemeMode,
} from '../styles/tokens';

// Legacy public shape consumed across the app. A2+ migrations will move
// consumers onto token keys directly; this adapter keeps them working
// unchanged in the meantime.

export type { ThemeMode };

export interface ThemeShadows {
  sm: string;
  md: string;
  lg: string;
  glow: string;
}

export interface ThemeColors {
  bg: string;
  bgPanel: string;
  bgEditor: string;
  bgElevated: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string;
  accentLight: string;
  dirac: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  comment: string;
  string: string;
  number: string;
  gateSingle: string;
  gateMulti: string;
  gateMeasure: string;
  wire: string;
}

function legacyFromTokens(c: ColorTokens): ThemeColors {
  return {
    bg: c.surfaceBase,
    bgPanel: c.surfaceSunken,
    bgEditor: c.surfaceBase,
    bgElevated: c.surfaceRaised,
    border: c.borderSubtle,
    borderStrong: c.borderStrong,
    text: c.textPrimary,
    textMuted: c.textSecondary,
    textDim: c.textDisabled,
    accent: c.accentQuantum,
    accentLight: c.accentQuantumSoft,
    dirac: c.accentDirac,
    success: c.success,
    warning: c.warning,
    error: c.danger,
    info: c.info,
    comment: c.syntaxComment,
    string: c.syntaxString,
    number: c.syntaxNumber,
    gateSingle: c.gateSingle,
    gateMulti: c.gateMulti,
    gateMeasure: c.gateMeasure,
    wire: c.wire,
  };
}

function shadowsFromTokens(s: ShadowTokens): ThemeShadows {
  return { sm: s.sm, md: s.md, lg: s.lg, glow: s.glow };
}

interface ThemeState {
  mode: ThemeMode;
  colors: ThemeColors;
  shadow: ThemeShadows;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

function snapshot(mode: ThemeMode) {
  const colors = mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const shadow = mode === 'dark' ? DARK_SHADOWS : LIGHT_SHADOWS;
  return {
    mode,
    colors: legacyFromTokens(colors),
    shadow: shadowsFromTokens(shadow),
  };
}

export const useThemeStore = create<ThemeState>((set) => ({
  ...snapshot('dark'),
  setMode: (mode) => set(snapshot(mode)),
  toggle: () => set((s) => snapshot(s.mode === 'dark' ? 'light' : 'dark')),
}));
