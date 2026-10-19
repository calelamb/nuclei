// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LANDING_PROPS } from './useLandingRef';

afterEach(cleanup);

describe('LANDING_PROPS', () => {
  it('makes a heading focusable by script only and marks it as a landing target', () => {
    const { getByText } = render(<h2 {...LANDING_PROPS}>Title</h2>);
    const h = getByText('Title');
    expect(h.getAttribute('tabindex')).toBe('-1');
    expect(h.hasAttribute('data-nav-landing')).toBe(true);
  });
});
