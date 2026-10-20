import { describe, expect, it } from 'vitest';
import { shouldRenderBottomPanel } from './bottomPanelPresence';

describe('shouldRenderBottomPanel', () => {
  it('stays closed after a silent first run (result only, no output)', () => {
    expect(shouldRenderBottomPanel({ panelVisible: false, hasResult: true, hasOutput: false })).toBe(false);
  });
  it('opens once the run printed something', () => {
    expect(shouldRenderBottomPanel({ panelVisible: false, hasResult: true, hasOutput: true })).toBe(true);
  });
  it('follows the registry when the panel is visible', () => {
    expect(shouldRenderBottomPanel({ panelVisible: true, hasResult: false, hasOutput: false })).toBe(true);
  });
  it('stays closed with nothing at all', () => {
    expect(shouldRenderBottomPanel({ panelVisible: false, hasResult: false, hasOutput: false })).toBe(false);
  });
});
