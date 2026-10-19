// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { NucleiMark } from './NucleiMark';

describe('NucleiMark', () => {
  it('is decorative (aria-hidden, no role) without a title', () => {
    const { container } = render(<NucleiMark size={20} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.getAttribute('width')).toBe('20');
  });

  it('is an image with an accessible name when titled', () => {
    const { getByRole } = render(<NucleiMark title="Nuclei" />);
    const svg = getByRole('img');
    expect(svg.getAttribute('aria-label')).toBe('Nuclei');
    expect(svg.getAttribute('aria-hidden')).toBeNull();
  });

  it('thickens the stroke at 16px and below', () => {
    const small = render(<NucleiMark size={16} />).container.querySelector('svg')!;
    const large = render(<NucleiMark size={17} />).container.querySelector('svg')!;
    expect(small.getAttribute('stroke-width')).toBe('3');
    expect(large.getAttribute('stroke-width')).toBe('2.6');
  });

  it('draws in currentColor with three strokes', () => {
    const svg = render(<NucleiMark />).container.querySelector('svg')!;
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.querySelectorAll('path')).toHaveLength(3);
  });
});
