import { describe, expect, it } from 'vitest';
import { edgeFadeStyle, scrollEdges } from './edgeFades';

const box = { scrollTop: 0, scrollLeft: 0, scrollHeight: 283, scrollWidth: 624, clientHeight: 245, clientWidth: 332 };

describe('scrollEdges', () => {
  it('reports the clipped bottom and right of a circuit larger than its pane', () => {
    expect(scrollEdges(box)).toEqual({ top: false, bottom: true, left: false, right: true });
  });
  it('reports nothing for content that fits, and the start edges once scrolled to the end', () => {
    expect(scrollEdges({ ...box, scrollHeight: 245, scrollWidth: 332 })).toEqual({ top: false, bottom: false, left: false, right: false });
    expect(scrollEdges({ ...box, scrollTop: 38, scrollLeft: 292 })).toEqual({ top: true, bottom: false, left: true, right: false });
  });
});

describe('edgeFadeStyle', () => {
  it('is absent when nothing overflows and fades only the clipped edges otherwise', () => {
    expect(edgeFadeStyle({ top: false, bottom: false, left: false, right: false })).toBeUndefined();
    const style = edgeFadeStyle({ top: false, bottom: true, left: false, right: true });
    expect(String(style?.maskImage)).toContain('to bottom');
    expect(String(style?.maskImage)).toContain('to right');
    expect(String(edgeFadeStyle({ top: false, bottom: true, left: false, right: false })?.maskImage)).not.toContain('to right');
  });
});
