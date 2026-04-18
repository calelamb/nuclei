// src/stores/themeStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore } from './themeStore';
import { DARK_COLORS, LIGHT_COLORS } from '../styles/tokens';

describe('themeStore', () => {
  beforeEach(() => {
    useThemeStore.getState().setMode('dark');
  });

  it('starts in dark mode', () => {
    expect(useThemeStore.getState().mode).toBe('dark');
  });

  it('setMode(light) applies the light palette', () => {
    useThemeStore.getState().setMode('light');
    const { colors, mode } = useThemeStore.getState();
    expect(mode).toBe('light');
    expect(colors.bg.toLowerCase()).toBe(LIGHT_COLORS.surfaceBase.toLowerCase());
    expect(colors.accent.toLowerCase()).toBe(LIGHT_COLORS.accentQuantum.toLowerCase());
  });

  it('setMode(dark) applies the dark palette', () => {
    useThemeStore.getState().setMode('light');
    useThemeStore.getState().setMode('dark');
    const { colors } = useThemeStore.getState();
    expect(colors.bg.toLowerCase()).toBe(DARK_COLORS.surfaceBase.toLowerCase());
  });

  it('toggle alternates between modes', () => {
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().mode).toBe('light');
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().mode).toBe('dark');
  });
});
