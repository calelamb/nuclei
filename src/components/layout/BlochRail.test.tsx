// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
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
