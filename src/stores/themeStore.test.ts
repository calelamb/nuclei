// src/stores/themeStore.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  describe('theme preference (System option)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('defaults to an explicit dark preference', () => {
      expect(useThemeStore.getState().preference).toBe('dark');
    });

    it('System resolves to light when the OS prefers light', () => {
      vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
      useThemeStore.getState().setPreference('system');
      expect(useThemeStore.getState().preference).toBe('system');
      expect(useThemeStore.getState().mode).toBe('light');
    });

    it('System resolves to dark when the OS prefers dark', () => {
      vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
      useThemeStore.getState().setPreference('system');
      expect(useThemeStore.getState().mode).toBe('dark');
    });

    it('toggle() turns System into an explicit choice', () => {
      vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
      useThemeStore.getState().setPreference('system');
      useThemeStore.getState().toggle();
      expect(useThemeStore.getState().preference).toBe('light');
      expect(useThemeStore.getState().mode).toBe('light');
    });

    it('setMode pins the preference to that explicit mode', () => {
      useThemeStore.getState().setPreference('system');
      useThemeStore.getState().setMode('light');
      expect(useThemeStore.getState().preference).toBe('light');
    });

    it('syncSystem follows the OS only while the preference is system', () => {
      useThemeStore.getState().setMode('dark');
      useThemeStore.getState().syncSystem(false);
      expect(useThemeStore.getState().mode).toBe('dark');
      useThemeStore.getState().setPreference('system');
      useThemeStore.getState().syncSystem(false);
      expect(useThemeStore.getState().mode).toBe('light');
    });
  });
});
