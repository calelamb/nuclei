import { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface VideoThumbProps {
  youtubeId: string;
  /** Which YouTube still to request. */
  quality: 'mqdefault' | 'hqdefault';
  className: string;
  width?: number;
  height?: number;
}

/**
 * YouTube still with a graceful fallback: a dead or blocked poster renders a
 * quiet placeholder instead of a broken or grey tile.
 */
export function VideoThumb({ youtubeId, quality, className, width, height }: VideoThumbProps) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`${className} video-thumb--missing`} data-testid="video-thumb-missing" aria-hidden="true">
        <ImageOff size={20} strokeWidth={1.5} />
      </span>
    );
  }
  return (
    <img
      className={className}
      src={`https://img.youtube.com/vi/${youtubeId}/${quality}.jpg`}
      alt=""
      loading="lazy"
      width={width}
      height={height}
      onError={() => setFailed(true)}
    />
  );
}
