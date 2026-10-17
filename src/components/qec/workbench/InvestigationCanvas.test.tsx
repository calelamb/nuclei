// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { InvestigationCanvas } from './InvestigationCanvas';
import { orderCanvasPanels } from './orderCanvasPanels';
import { resolveQecPanels } from '../../../layout/qecPanelRegistry';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { useQecCampaignStore } from '../../../stores/qecCampaignStore';

afterEach(() => cleanup());
beforeEach(() => useQecCampaignStore.getState().reset());

describe('canvas instrument order (qec-07)', () => {
  it('puts the Analyze preset\'s own instrument first', () => {
    const panels = resolveQecPanels('analyze', 'canvas', []);
    expect(panels[0].id).not.toBe('campaign-center');
    expect(orderCanvasPanels('analyze', panels)[0].id).toBe('campaign-center');
  });

  it('leaves the other presets alone', () => {
    const panels = resolveQecPanels('build', 'canvas', []);
    expect(orderCanvasPanels('build', panels)).toEqual(panels);
  });

  it('renders Campaign Center as the first instrument in Analyze with a route to CSV import', () => {
    useQecWorkbenchStore.setState({ preset: 'analyze' });
    const noop = () => undefined;
    render(<InvestigationCanvas inspectorOpen onToggleInspector={noop} toggleRef={{ current: null }} />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Campaign Center');
    expect(screen.getByLabelText('Open sinter stats CSV')).toBeTruthy();
  });
});
