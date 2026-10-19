// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { useLandingRef } from './useLandingRef';

let focused: boolean | null = null;
function Heading() {
  const landing = useLandingRef<HTMLHeadingElement>();
  useEffect(() => { focused = landing.focus(); }, [landing]);
  return <h2 ref={landing.ref} {...landing.props}>Title</h2>;
}

afterEach(() => { cleanup(); focused = null; });

describe('useLandingRef', () => {
  it('makes a heading focusable by script only, marks it as a landing target, and can focus it', () => {
    const { getByText } = render(<Heading />);
    const h = getByText('Title');
    expect(h.getAttribute('tabindex')).toBe('-1');
    expect(h.hasAttribute('data-nav-landing')).toBe(true);
    expect(focused).toBe(true);
    expect(document.activeElement).toBe(h);
  });
});
