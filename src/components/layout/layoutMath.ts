export const DEFAULT_EDITOR_PANE_WIDTH = 60;
export const MIN_EDITOR_PANE_WIDTH = 25;
export const MAX_EDITOR_PANE_WIDTH = 75;

export function clampEditorPaneWidth(widthPercent: number): number {
  return Math.max(MIN_EDITOR_PANE_WIDTH, Math.min(MAX_EDITOR_PANE_WIDTH, widthPercent));
}

export function computeEditorPaneWidth(clientX: number, rect: { left: number; width: number }): number {
  if (rect.width <= 0) return DEFAULT_EDITOR_PANE_WIDTH;
  const widthPercent = ((clientX - rect.left) / rect.width) * 100;
  return clampEditorPaneWidth(widthPercent);
}
