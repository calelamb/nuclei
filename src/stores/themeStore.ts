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

/** What the user picked. `system` follows the OS and resolves to a ThemeMode. */
export type ThemePreference = 'system' | ThemeMode;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'dark' || value === 'light';
}

/** Resolve a preference to a concrete mode. Falls back to dark without matchMedia. */
export function resolveThemePreference(pref: ThemePreference): ThemeMode {
  if (pref !== 'system') return pref;
  try {
    const mq = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;
    if (!mq) return 'dark';
    return mq.matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

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
  /** Disabled controls only. Never use for readable text. */
  textDisabled: string;
  accent: string;
  accentLight: string;
  /** Teal for small text/links (AA on every surface); `accent` is for fills, borders and icons. */
  accentText: string;
  /** Text on a solid `accent` fill. */
  onAccent: string;
  dirac: string;
  /** Dirac purple for text (AA contrast); `dirac` is for fills only. */
  diracText: string;
  modeResearch: string;
  basisX: string;
  basisZ: string;
  overlayMatching: string;
  success: string;
  /** Green for small text/glyphs (AA on every surface); `success` is for fills and dots. */
  successText: string;
  warning: string;
  error: string;
  info: string;
  /** Modal backdrop colour. */
  scrim: string;
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
    textDim: c.textTertiary,
    textDisabled: c.textDisabled,
    accent: c.accentQuantum,
    accentLight: c.accentQuantumSoft,
    accentText: c.accentQuantumText,
    onAccent: c.onAccent,
    dirac: c.accentDirac,
    diracText: c.accentDiracText,
    modeResearch: c.modeResearch,
    basisX: c.basisX,
    basisZ: c.basisZ,
    overlayMatching: c.overlayMatching,
    success: c.success,
    successText: c.successText,
    warning: c.warning,
    error: c.danger,
    info: c.info,
    scrim: c.scrim,
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
  /** The user's choice; `mode` is what it currently resolves to. */
  preference: ThemePreference;
  colors: ThemeColors;
  shadow: ThemeShadows;
  /**
   * A plugin-contributed colour overlay merged on top of the active theme.
   * Null when no plugin theme is applied. Only keys that exist on
   * `ThemeColors` are kept — a plugin's unknown keys are ignored.
   */
  pluginOverlay: Partial<ThemeColors> | null;
  setMode: (mode: ThemeMode) => void;
  setPreference: (pref: ThemePreference) => void;
  /** Re-resolve `system` against the OS (pass the OS's dark flag from a matchMedia listener). */
  syncSystem: (osPrefersDark: boolean) => void;
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

/** Until the user picks a theme the app follows the OS, so a light-mode machine never opens dark. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

export const useThemeStore = create<ThemeState>((set, get) => ({
  ...snapshot(resolveThemePreference(DEFAULT_THEME_PREFERENCE), null),
  preference: DEFAULT_THEME_PREFERENCE,
  pluginOverlay: null,
  setMode: (mode) => set({ ...snapshot(mode, get().pluginOverlay), preference: mode }),
  setPreference: (preference) =>
    set({ ...snapshot(resolveThemePreference(preference), get().pluginOverlay), preference }),
  syncSystem: (osPrefersDark) => {
    if (get().preference !== 'system') return;
    set(snapshot(osPrefersDark ? 'dark' : 'light', get().pluginOverlay));
  },
  toggle: () =>
    set((s) => {
      const next: ThemeMode = s.mode === 'dark' ? 'light' : 'dark';
      return { ...snapshot(next, s.pluginOverlay), preference: next };
    }),
  applyPluginTheme: (raw) => {
    const overlay = intersectThemeColors(raw);
    set((s) => ({ ...snapshot(s.mode, overlay), pluginOverlay: overlay }));
  },
  clearPluginTheme: () => set((s) => ({ ...snapshot(s.mode, null), pluginOverlay: null })),
}));
