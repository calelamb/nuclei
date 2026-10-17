// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { usePersistedPrefs } from './usePersistedPrefs';
import { useUIModeStore } from '../stores/uiModeStore';
import { useThemeStore } from '../stores/themeStore';

afterEach(() => {
  cleanup();
  useUIModeStore.setState({ mode: 'intermediate' });
  useThemeStore.getState().setMode('dark');
});

function fakePlatform() {
  return { setStoredValue: vi.fn().mockResolvedValue(undefined) };
}

describe('usePersistedPrefs', () => {
  it('persists the UI mode whenever any caller changes it', () => {
    const platform = fakePlatform();
    renderHook(() => usePersistedPrefs(platform as never, true));
    act(() => useUIModeStore.getState().setMode('beginner'));
    expect(platform.setStoredValue).toHaveBeenCalledWith('ui_mode', 'beginner');
  });

  it('persists the theme preference, including System', () => {
    const platform = fakePlatform();
    renderHook(() => usePersistedPrefs(platform as never, true));
    act(() => useThemeStore.getState().setPreference('light'));
    expect(platform.setStoredValue).toHaveBeenCalledWith('theme', 'light');
    act(() => useThemeStore.getState().setPreference('system'));
    expect(platform.setStoredValue).toHaveBeenCalledWith('theme', 'system');
  });

  it('writes nothing before the stored preferences have been read', () => {
    const platform = fakePlatform();
    renderHook(() => usePersistedPrefs(platform as never, false));
    act(() => useUIModeStore.getState().setMode('advanced'));
    expect(platform.setStoredValue).not.toHaveBeenCalled();
  });

  it('does not rewrite a value that did not change', () => {
    const platform = fakePlatform();
    renderHook(() => usePersistedPrefs(platform as never, true));
    act(() => useUIModeStore.getState().setMode('intermediate'));
    expect(platform.setStoredValue).not.toHaveBeenCalledWith('ui_mode', expect.anything());
  });
});
