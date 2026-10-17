// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { VideoThumb } from './VideoThumb';

afterEach(cleanup);

describe('VideoThumb', () => {
  it('requests the YouTube still at the chosen quality', () => {
    const { container } = render(<VideoThumb youtubeId="abc123DEF45" quality="mqdefault" className="x" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://img.youtube.com/vi/abc123DEF45/mqdefault.jpg');
  });

  it("treats YouTube's 120x90 grey still for a dead id as a missing poster", () => {
    const { container } = render(<VideoThumb youtubeId="dead0000000" quality="hqdefault" className="x" />);
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 120 });
    fireEvent.load(img);
    expect(screen.getByTestId('video-thumb-missing')).toBeTruthy();
  });

  it('keeps a real still', () => {
    const { container } = render(<VideoThumb youtubeId="live0000000" quality="hqdefault" className="x" />);
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 480 });
    fireEvent.load(img);
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('swaps a failed poster for a placeholder instead of a broken tile', () => {
    const { container } = render(<VideoThumb youtubeId="dead0000000" quality="hqdefault" className="x" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('video-thumb-missing').className).toContain('x');
  });
});
