import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';

const KEYBOARD_STEP = 16;

interface QecWorkbenchResizeHandleProps {
  label: string;
  orientation: 'horizontal' | 'vertical';
  value: number;
  min: number;
  max: number;
  direction: 1 | -1;
  onChange(value: number): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function QecWorkbenchResizeHandle({
  label,
  orientation,
  value,
  min,
  max,
  direction,
  onChange,
}: QecWorkbenchResizeHandleProps): ReactElement {
  const stopDragging = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDragging.current?.(), []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const forwardKey = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    const backwardKey = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    let next: number | null = null;
    if (event.key === forwardKey) next = value + (KEYBOARD_STEP * direction);
    if (event.key === backwardKey) next = value - (KEYBOARD_STEP * direction);
    if (event.key === 'Home') next = min;
    if (event.key === 'End') next = max;
    if (next === null) return;
    event.preventDefault();
    onChange(clamp(next, min, max));
  };

  const onMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startCoordinate = orientation === 'vertical' ? event.clientX : event.clientY;
    const move = (moveEvent: globalThis.MouseEvent): void => {
      const coordinate = orientation === 'vertical' ? moveEvent.clientX : moveEvent.clientY;
      onChange(clamp(value + ((coordinate - startCoordinate) * direction), min, max));
    };
    const stop = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      stopDragging.current = null;
    };
    stopDragging.current?.();
    stopDragging.current = stop;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
  };

  return (
    <div
      className={`qec-resize-handle qec-resize-handle--${orientation}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
    />
  );
}
