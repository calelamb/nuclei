import { describe, expect, it } from 'vitest';
import {
  QEC_PANEL_REGISTRY,
  resolveQecPreset,
  validateQecPanelRegistry,
  type QecWorkbenchPanelDef,
} from './qecPanelRegistry';
import type { QecWorkspacePreset } from '../types/qecStudy';

describe('QEC panel registry', () => {
  it.each([
    ['build', 'editor'],
    ['analyze', 'campaign-center'],
    ['observe', 'stream-health'],
  ] as const)('%s preset makes %s primary', (preset, primary) => {
    expect(resolveQecPreset(preset).primary).toContain(primary);
  });

  it('keeps panel definitions in deterministic order', () => {
    expect(QEC_PANEL_REGISTRY.map((panel) => panel.id)).toEqual([
      'editor',
      'timeline',
      'lattice',
      'detector-graph',
      'campaign-center',
      'failure-microscope',
      'stream-health',
      'calibration-timeline',
      'research-inspector',
      'jobs',
    ]);
  });

  it('rejects duplicate panel ids', () => {
    const duplicate: QecWorkbenchPanelDef = { ...QEC_PANEL_REGISTRY[0], order: 99 };
    expect(() => validateQecPanelRegistry([...QEC_PANEL_REGISTRY, duplicate])).toThrow(
      'Duplicate QEC workbench panel id: editor',
    );
  });

  it('rejects duplicate panel orders', () => {
    const duplicateOrder: QecWorkbenchPanelDef = { ...QEC_PANEL_REGISTRY[1], order: 0 };
    expect(() => validateQecPanelRegistry([QEC_PANEL_REGISTRY[0], duplicateOrder])).toThrow(
      'Duplicate QEC workbench panel order: 0',
    );
  });

  it('deeply freezes panel records and their preset arrays', () => {
    const editor = QEC_PANEL_REGISTRY[0];
    expect(Object.isFrozen(QEC_PANEL_REGISTRY)).toBe(true);
    expect(Object.isFrozen(editor)).toBe(true);
    expect(Object.isFrozen(editor.presets)).toBe(true);
    expect(() => (editor.presets as QecWorkspacePreset[]).push('observe')).toThrow();
    expect(resolveQecPreset('build').primary).toContain('editor');
  });
});
