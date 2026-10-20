import type { PointerEvent } from 'react';
import './resizeHandle.css';

/* ── Resize Handle ──
 * A 1px rule with a wider invisible hit area. Hover and drag are drawn by an overlay
 * (see resizeHandle.css), so the layout never shifts and nothing is written onto the DOM
 * by hand. The pointer is captured on press, so a drag that leaves the window still ends. */
export function ResizeHandle({ direction, isDragging, onMouseDown, onDoubleClick }: {
  direction: 'horizontal' | 'vertical'; isDragging: boolean; onMouseDown: () => void; onDoubleClick: () => void;
}) {
  const isH = direction === 'horizontal';
  const press = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onMouseDown();
  };
  return (
    <div
      className={`resize-handle resize-handle--${isH ? 'h' : 'v'}`}
      data-dragging={isDragging ? 'true' : undefined}
      role="separator"
      // A horizontal drag direction means a vertical rule between side-by-side panes.
      aria-orientation={isH ? 'vertical' : 'horizontal'}
      onPointerDown={press}
      onDoubleClick={onDoubleClick}
    />
  );
}
