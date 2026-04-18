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
  // Accents
  accentQuantum: string;
  accentQuantumSoft: string;
  accentDirac: string;
  // Semantics
  success: string;
  warning: string;
  danger: string;
  info: string;
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
  s1: string; s2: string; s3: string; s4: string;
  s5: string; s6: string; s8: string; s12: string;
}

export interface RadiusTokens {
  sharp: string;
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
  weightRegular: string;
  weightMedium: string;
  weightSemibold: string;
  weightBold: string;
}

export const DARK_COLORS: ColorTokens = {
  surfaceBase: '#0F1B2D',
  surfaceRaised: '#152238',
  surfaceOverlay: '#1A2A42',
  surfaceSunken: '#080E18',
  textPrimary: '#E8ECF1',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  textDisabled: '#475569',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderStrong: '#1A2A42',
  accentQuantum: '#00B4D8',
  accentQuantumSoft: '#48CAE4',
  accentDirac: '#7B2D8E',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
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
  surfaceOverlay: '#F1F5F9',
  surfaceSunken: '#E2E8F0',
  textPrimary: '#1A1A2E',
  textSecondary: '#475569',
  textTertiary: '#64748B',
  textDisabled: '#94A3B8',
  borderSubtle: 'rgba(0, 0, 0, 0.06)',
  borderStrong: '#E2E8F0',
  accentQuantum: '#0891B2',
  accentQuantumSoft: '#00B4D8',
  accentDirac: '#6B21A8',
  success: '#059669',
  warning: '#D97706',
  danger: '#DC2626',
  info: '#2563EB',
  kernelIdle: '#94A3B8',
  kernelConnecting: '#D97706',
  kernelReady: '#059669',
  kernelError: '#DC2626',
  syntaxComment: '#6A737D',
  syntaxString: '#22863A',
  syntaxNumber: '#B76E00',
  syntaxKeyword: '#0891B2',
  syntaxType: '#005F73',
  gateSingle: '#0891B2',
  gateMulti: '#3B6EA5',
  gateMeasure: '#6A737D',
  wire: '#959DA5',
};

export const DARK_SHADOWS: ShadowTokens = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
  md: '0 4px 12px rgba(0, 0, 0, 0.4)',
  lg: '0 8px 24px rgba(0, 0, 0, 0.5)',
  glow: '0 0 20px rgba(0, 180, 216, 0.15)',
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
  s1: '4px', s2: '8px', s3: '12px', s4: '16px',
  s5: '20px', s6: '24px', s8: '32px', s12: '48px',
};

export const RADIUS: RadiusTokens = {
  sharp: '0',
  soft: '4px',
  round: '8px',
  pill: '999px',
};

export const TYPOGRAPHY: TypographyTokens = {
  fontSans: "'Geist Sans', Inter, -apple-system, system-ui, sans-serif",
  fontMono: "'JetBrains Mono', 'Geist Mono', ui-monospace, monospace",
  sizeDisplay: '28px',
  sizeTitle: '20px',
  sizeBody: '14px',
  sizeCode: '13px',
  sizeCaption: '11px',
  sizeChromeLabel: '12px',
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
