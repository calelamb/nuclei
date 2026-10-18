import { describe, it, expect } from 'vitest';
import { visibleVizPanelIds, vizColumnHasContent, vizPlaceholder } from './vizPanels';
import type { VisiblePanels } from './panelRegistry';

const NONE: VisiblePanels = {
  circuit: false, bloch: false, histogramChip: false, histogramFull: false, terminal: true,
  qecTimeline: false, qecLattice: false, qecDetectorGraph: false,
} as VisiblePanels;
const vis = (over: Partial<VisiblePanels>): VisiblePanels => ({ ...NONE, ...over });

describe('visibleVizPanelIds', () => {
  it('lists circuit then bloch in rail order', () => {
    expect(visibleVizPanelIds(vis({ bloch: true, circuit: true }), { latticeHasCoords: false }))
      .toEqual(['circuit', 'bloch']);
  });

  it('hides the code lattice when the circuit has no coordinates', () => {
    expect(visibleVizPanelIds(vis({ qecLattice: true, qecTimeline: true }), { latticeHasCoords: false }))
      .toEqual(['qecTimeline']);
  });

  it('drops the gate diagram next to the QEC panels (a Stim circuit can be thousands of gates)', () => {
    expect(visibleVizPanelIds(vis({ circuit: true, qecTimeline: true }), { latticeHasCoords: false }))
      .toEqual(['qecTimeline']);
  });
});

describe('vizColumnHasContent', () => {
  it('is false when no panel and no chip is shown, so the column can collapse', () => {
    expect(vizColumnHasContent(vis({}), { latticeHasCoords: false }, false)).toBe(false);
  });
  it('is true when a main panel is visible', () => {
    expect(vizColumnHasContent(vis({ circuit: true }), { latticeHasCoords: false }, false)).toBe(true);
  });
  it('is true when only the histogram chip is shown', () => {
    expect(vizColumnHasContent(vis({}), { latticeHasCoords: false }, true)).toBe(true);
  });
});

describe('vizPlaceholder (the column is held open while Python boots or has failed)', () => {
  const base = { hasContent: false, kernelStatus: 'idle', kernelReady: false, isWeb: true };

  it('holds the column for a booting web kernel only', () => {
    expect(vizPlaceholder({ ...base, kernelStatus: 'connecting' })).toBe('booting');
    expect(vizPlaceholder({ ...base, kernelStatus: 'connecting', isWeb: false })).toBeNull();
  });

  it('keeps the column on failure, on web and desktop, so Retry does not make the editor jump', () => {
    expect(vizPlaceholder({ ...base, kernelStatus: 'failed' })).toBe('failed');
    expect(vizPlaceholder({ ...base, kernelStatus: 'failed', isWeb: false })).toBe('failed');
  });

  it('steps aside as soon as the column has real content', () => {
    expect(vizPlaceholder({ ...base, hasContent: true, kernelStatus: 'failed' })).toBeNull();
  });

  it('is not a failure once the kernel is ready again', () => {
    expect(vizPlaceholder({ ...base, kernelStatus: 'failed', kernelReady: true })).toBeNull();
  });
});
