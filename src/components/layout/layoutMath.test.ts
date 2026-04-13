import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDITOR_PANE_WIDTH,
  MAX_EDITOR_PANE_WIDTH,
  MIN_EDITOR_PANE_WIDTH,
  clampEditorPaneWidth,
  computeEditorPaneWidth,
} from './layoutMath';

describe('layoutMath', () => {
  it('clamps editor pane width into the supported range', () => {
    expect(clampEditorPaneWidth(10)).toBe(MIN_EDITOR_PANE_WIDTH);
    expect(clampEditorPaneWidth(90)).toBe(MAX_EDITOR_PANE_WIDTH);
    expect(clampEditorPaneWidth(60)).toBe(60);
  });

  it('computes editor pane width from mouse position', () => {
    expect(computeEditorPaneWidth(300, { left: 0, width: 1000 })).toBe(30);
    expect(computeEditorPaneWidth(800, { left: 0, width: 1000 })).toBe(75);
  });

  it('falls back to the default width when the container width is invalid', () => {
    expect(computeEditorPaneWidth(500, { left: 0, width: 0 })).toBe(DEFAULT_EDITOR_PANE_WIDTH);
  });
});
