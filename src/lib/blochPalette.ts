import type { ThemeMode } from '../styles/tokens';

export interface BlochPalette {
  axisX: string;
  axisY: string;
  axisZ: string;
  state: string;
  wire: string;
  equator: string;
  label: string;
  /** Translucent back-face shell of the sphere. */
  shell: string;
  shellOpacity: number;
}

const DARK: BlochPalette = {
  axisX: '#e05252',
  axisY: '#3ddc84',
  axisZ: '#4a9eff',
  state: '#00e5ff',
  wire: '#42506a',
  equator: '#5b6d8a',
  label: '#cdd6e2',
  shell: '#0d1520',
  shellOpacity: 0.18,
};

// Axis hues keep their identity but are darkened ~15% so they hold >= 3:1 on a light tile.
const LIGHT: BlochPalette = {
  axisX: '#c23b3b',
  axisY: '#1a8f4d',
  axisZ: '#2563eb',
  state: '#0e7490',
  wire: '#94a3b8',
  equator: '#64748b',
  label: '#334155',
  shell: '#cbd5e1',
  shellOpacity: 0.35,
};

/** Bloch-sphere colours for the active theme. */
export function blochPalette(mode: ThemeMode): BlochPalette {
  return mode === 'dark' ? DARK : LIGHT;
}
