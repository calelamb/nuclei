// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BlochRail } from './BlochRail';

afterEach(cleanup);

describe('BlochRail', () => {
  it('sizes to its content instead of filling the rail, so no dead bands open around the tiles', () => {
    render(<BlochRail><div>tiles</div></BlochRail>);
    const rail = screen.getByTestId('bloch-rail');
    expect(rail.style.flexGrow).toBe('0');
    expect(rail.style.flexShrink).toBe('1');
  });

  it('does not vertically centre the content', () => {
    render(<BlochRail><div>tiles</div></BlochRail>);
    const inner = screen.getByTestId('bloch-rail').firstElementChild as HTMLElement;
    expect(inner.style.marginTop).not.toBe('auto');
    expect(inner.style.marginBottom).not.toBe('auto');
  });
});

const STATE = { result: { bloch_coords: [[0, 0, 1], [0, 0, 1], [0, 0, 1]] } };

describe('BlochRail tightening', () => {
  it('shrinks to the height the grid really uses when the column left it taller than needed', async () => {
    vi.resetModules();
    vi.doMock('../../hooks/useElementSize', () => ({
      useElementSize: () => [() => undefined, { width: 310, height: 230 }],
    }));
    vi.doMock('../../stores/simulationStore', () => ({
      useSimulationStore: (sel: (s: unknown) => unknown) => sel(STATE),
    }));
    const { BlochRail: Rail } = await import('./BlochRail');
    const { blochRailUsedHeight, blochRailHeights } = await import('../../layout/blochRail');
    render(<Rail><div>tiles</div></Rail>);
    const used = blochRailUsedHeight(3, 310, 230);
    expect(used).toBeLessThan(230);
    const h = parseInt(screen.getByTestId('bloch-rail').style.height, 10);
    expect(h).toBe(Math.max(used, blochRailHeights(3, 310).min));
    vi.doUnmock('../../hooks/useElementSize');
    vi.doUnmock('../../stores/simulationStore');
  });
});
