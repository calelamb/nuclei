// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BlochRail } from './BlochRail';

afterEach(() => cleanup());

describe('BlochRail', () => {
  it('fills the rest of the rail while there is nothing to draw, so the empty state is centred', () => {
    render(<BlochRail count={0}><div>empty</div></BlochRail>);
    expect(screen.getByTestId('bloch-rail').style.flexGrow).toBe('1');
  });

  it('takes every pixel the circuit leaves, never less than one row of spheres', () => {
    render(<BlochRail count={1}><div>tiles</div></BlochRail>);
    const rail = screen.getByTestId('bloch-rail');
    expect(rail.style.flexGrow).toBe('1');
    expect(parseInt(rail.style.minHeight, 10)).toBeGreaterThanOrEqual(148);
  });

  it('does not vertically centre the content', () => {
    render(<BlochRail count={1}><div>tiles</div></BlochRail>);
    const inner = screen.getByTestId('bloch-rail').firstElementChild as HTMLElement;
    expect(inner.style.marginTop).not.toBe('auto');
    expect(inner.style.marginBottom).not.toBe('auto');
  });
});
