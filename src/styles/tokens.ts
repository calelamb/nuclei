// src/styles/tokens.ts
//
// Single typed source of truth for design tokens. The CSS file `tokens.css`
// is generated from this shape — the sync test asserts they stay aligned.
// Use these values from TypeScript when a CSS variable isn't an option
// (Monaco theme generation, Three.js materials, D3 scales).

export type ThemeMode = 'dark' | 'light';

export interface ColorTokens {
  // Surfaces
  surfaceBase: string;
  surfaceRaised: string;
  surfaceOverlay: string;
  surfaceSunken: string;
  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  // Borders
  borderSubtle: string;
  borderStrong: string;
  /** Boundary of inputs, selects, checkboxes and switch tracks: 3:1 against every surface (WCAG 1.4.11). */
  borderControl: string;
  // Accents
  accentQuantum: string;
  accentQuantumSoft: string;
  /** Teal for small text/links: AA on every surface in both themes (accentQuantum fails on white). */
  accentQuantumText: string;
  /** Text/icon colour on a solid accentQuantum fill. */
  onAccent: string;
  accentDirac: string;
  /** Dirac purple tuned for use as TEXT (AA on every surface); accentDirac is for fills. */
  accentDiracText: string;
  // Domain identities (purple is reserved for Dirac)
  modeResearch: string;
  basisX: string;
  basisZ: string;
  overlayMatching: string;
  // Semantics
  success: string;
  /** Green for small text/glyphs: AA on every surface in both themes (success is for fills and dots). */
  successText: string;
  warning: string;
  /** Amber/red for small text on a tinted wash (badges); `warning`/`danger` are fills and dots. */
  warningText: string;
  dangerText: string;
  danger: string;
  /** Solid destructive fill under on-danger text (hover of the danger button): AA at 12px. */
  dangerStrong: string;
  onDanger: string;
  info: string;
  /** Modal backdrop colour (dialogs, palette, shortcuts sheet). */
  scrim: string;
  // Kernel status
  kernelIdle: string;
  kernelConnecting: string;
  kernelReady: string;
  kernelError: string;
  // Syntax (used by Monaco + markdown preview)
  syntaxComment: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxKeyword: string;
  syntaxType: string;
  // Circuit
  gateSingle: string;
  gateMulti: string;
  gateMeasure: string;
  wire: string;
}

export interface ShadowTokens {
  sm: string;
  md: string;
  lg: string;
  glow: string;
}

export interface MotionTokens {
  durationFast: string;
  durationNormal: string;
  durationSlow: string;
  easeStandard: string;
  easeEmphasizedOut: string;
  easeEmphasizedIn: string;
}

export interface SpacingTokens {
  s0: string; s1: string; s2: string; s3: string; s4: string;
  s5: string; s6: string; s8: string; s12: string;
}

export interface RadiusTokens {
  sharp: string;
  xs: string;
  soft: string;
  round: string;
  pill: string;
}

export interface TypographyTokens {
  fontSans: string;
  fontMono: string;
  sizeDisplay: string;
  sizeTitle: string;
  sizeBody: string;
  sizeCode: string;
  sizeCaption: string;
  sizeChromeLabel: string;
  sizeHeading: string;
  weightRegular: string;
  weightMedium: string;
  weightSemibold: string;
  weightBold: string;
}

export const DARK_COLORS: ColorTokens = {
  // Approximate hex equivalents of oklch(~14% 0.008 250) and siblings — a
  // near-black with a slight cool tint. Monaco's theme API rejects oklch(),
  // so we keep hex here. The full oklch palette is a Plan 4 polish item.
  surfaceBase: '#0D131E',
  surfaceRaised: '#141B29',
  surfaceOverlay: '#1A2232',
  surfaceSunken: '#080D16',
  textPrimary: '#E8ECF1',
  textSecondary: '#94A3B8',
  textTertiary: '#7C8BA1',
  textDisabled: '#475569',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderStrong: '#1A2A42',
  borderControl: '#62728C',
  accentQuantum: '#00B4D8',
  accentQuantumSoft: '#48CAE4',
  accentQuantumText: '#00B4D8',
  onAccent: '#080D16',
  accentDirac: '#7B2D8E',
  accentDiracText: '#C084FC',
  modeResearch: '#60A5FA',
  basisX: '#00B4D8',
  basisZ: '#FBBF24',
  overlayMatching: '#FB923C',
  success: '#10B981',
  successText: '#10B981',
  warning: '#F59E0B',
  warningText: '#F59E0B',
  danger: '#EF4444',
  dangerStrong: '#DC2626',
  onDanger: '#FFFFFF',
  dangerText: '#F87171',
  info: '#3B82F6',
  scrim: 'rgba(0, 0, 0, 0.5)',
  kernelIdle: '#64748B',
  kernelConnecting: '#F59E0B',
  kernelReady: '#10B981',
  kernelError: '#EF4444',
  syntaxComment: '#6A737D',
  syntaxString: '#98C379',
  syntaxNumber: '#D19A66',
  syntaxKeyword: '#00B4D8',
  syntaxType: '#48CAE4',
  gateSingle: '#00B4D8',
  gateMulti: '#1E3A5F',
  gateMeasure: '#6A737D',
  wire: '#3D5A80',
};

export const LIGHT_COLORS: ColorTokens = {
  surfaceBase: '#FFFFFF',
  surfaceRaised: '#F8FAFC',
  surfaceOverlay: '#ECF0F5',
  surfaceSunken: '#F1F5F9',
  textPrimary: '#1A1A2E',
  textSecondary: '#475569',
  textTertiary: '#5B6B80',
  textDisabled: '#94A3B8',
  borderSubtle: 'rgba(0, 0, 0, 0.06)',
  borderStrong: '#E2E8F0',
  borderControl: '#7A889D',
  accentQuantum: '#0891B2',
  accentQuantumSoft: '#00B4D8',
  accentQuantumText: '#0E7490',
  onAccent: '#080D16',
  accentDirac: '#6B21A8',
  accentDiracText: '#6B21A8',
  modeResearch: '#1D4ED8',
  basisX: '#0E7490',
  basisZ: '#B45309',
  overlayMatching: '#C2410C',
  success: '#059669',
  successText: '#066048',
  warning: '#A8580A',
  warningText: '#8A4708',
  danger: '#DC2626',
  dangerStrong: '#B91C1C',
  onDanger: '#FFFFFF',
  dangerText: '#B91C1C',
  info: '#2563EB',
  scrim: 'rgba(15, 23, 42, 0.28)',
  kernelIdle: '#94A3B8',
  kernelConnecting: '#D97706',
  kernelReady: '#059669',
  kernelError: '#DC2626',
  syntaxComment: '#6A737D',
  syntaxString: '#22863A',
  syntaxNumber: '#B76E00',
  syntaxKeyword: '#0E7490',
  syntaxType: '#005F73',
  gateSingle: '#0891B2',
  gateMulti: '#3B6EA5',
  gateMeasure: '#6A737D',
  wire: '#959DA5',
};

export const DARK_SHADOWS: ShadowTokens = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.25)',
  md: '0 6px 18px rgba(0, 0, 0, 0.32)',
  lg: '0 12px 32px rgba(0, 0, 0, 0.4)',
  glow: '0 0 18px rgba(0, 180, 216, 0.14)',
};

export const LIGHT_SHADOWS: ShadowTokens = {
  sm: '0 1px 3px rgba(0, 0, 0, 0.08)',
  md: '0 4px 12px rgba(0, 0, 0, 0.1)',
  lg: '0 8px 24px rgba(0, 0, 0, 0.15)',
  glow: '0 0 20px rgba(8, 145, 178, 0.12)',
};

export const MOTION: MotionTokens = {
  durationFast: '120ms',
  durationNormal: '200ms',
  durationSlow: '360ms',
  easeStandard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easeEmphasizedOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeEmphasizedIn: 'cubic-bezier(0.7, 0, 0.84, 0)',
};

export const SPACING: SpacingTokens = {
  s0: '2px', s1: '4px', s2: '8px', s3: '12px', s4: '16px',
  s5: '20px', s6: '24px', s8: '32px', s12: '48px',
};

export const RADIUS: RadiusTokens = {
  sharp: '0',
  xs: '4px',
  soft: '6px',
  round: '10px',
  pill: '999px',
};

export const TYPOGRAPHY: TypographyTokens = {
  fontSans: "'Geist Sans', -apple-system, system-ui, sans-serif",
  fontMono: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  sizeDisplay: '28px',
  sizeTitle: '20px',
  sizeBody: '14px',
  sizeCode: '13px',
  sizeCaption: '11px',
  sizeChromeLabel: '12px',
  sizeHeading: '16px',
  weightRegular: '400',
  weightMedium: '500',
  weightSemibold: '600',
  weightBold: '700',
};

export function getColors(mode: ThemeMode): ColorTokens {
  return mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}

export function getShadows(mode: ThemeMode): ShadowTokens {
  return mode === 'dark' ? DARK_SHADOWS : LIGHT_SHADOWS;
}

/** Shared control heights (px) for Button / Select / Input primitives. */
export const CONTROL_HEIGHT = { sm: 24, md: 28, lg: 32 } as const;

/** The four sanctioned icon sizes (px). */
export const ICON_SIZE = { xs: 12, sm: 14, md: 16, lg: 20 } as const;
export const ICON_STROKE = 1.75;
