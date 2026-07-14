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
  /**
   * A plugin-contributed colour overlay merged on top of the active theme.
   * Null when no plugin theme is applied. Only keys that exist on
   * `ThemeColors` are kept — a plugin's unknown keys are ignored.
   */
  pluginOverlay: Partial<ThemeColors> | null;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  /** Apply a plugin theme's colours (intersected against known theme keys). */
  applyPluginTheme: (colors: Record<string, string>) => void;
  /** Remove any applied plugin theme, restoring the base theme. */
  clearPluginTheme: () => void;
}

// The set of legacy colour keys a plugin theme is allowed to override. Derived
// from a real snapshot so it can never drift from `ThemeColors`.
const THEME_COLOR_KEYS = Object.keys(legacyFromTokens(DARK_COLORS)) as (keyof ThemeColors)[];

/** Keep only the string values whose key is a real `ThemeColors` field. */
function intersectThemeColors(raw: Record<string, string>): Partial<ThemeColors> {
  const overlay: Partial<ThemeColors> = {};
  for (const key of THEME_COLOR_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) overlay[key] = value;
  }
  return overlay;
}

function snapshot(mode: ThemeMode, overlay: Partial<ThemeColors> | null) {
  const colors = mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const shadow = mode === 'dark' ? DARK_SHADOWS : LIGHT_SHADOWS;
  const base = legacyFromTokens(colors);
  return {
    mode,
    colors: overlay ? { ...base, ...overlay } : base,
    shadow: shadowsFromTokens(shadow),
  };
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  ...snapshot('dark', null),
  pluginOverlay: null,
  setMode: (mode) => set(snapshot(mode, get().pluginOverlay)),
  toggle: () => set((s) => snapshot(s.mode === 'dark' ? 'light' : 'dark', s.pluginOverlay)),
  applyPluginTheme: (raw) => {
    const overlay = intersectThemeColors(raw);
    set((s) => ({ ...snapshot(s.mode, overlay), pluginOverlay: overlay }));
  },
  clearPluginTheme: () => set((s) => ({ ...snapshot(s.mode, null), pluginOverlay: null })),
}));
