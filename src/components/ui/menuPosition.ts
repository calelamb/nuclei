export type MenuPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

export interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface MenuSize { width: number; height: number }
export interface MenuPosition { left: number; top: number; placement: MenuPlacement; maxHeight: number }

const GAP = 4;
const EDGE = 8;

/**
 * Where a menu goes relative to its trigger: preferred side first, flipped to
 * the other side when it does not fit, then clamped inside the viewport so it
 * can never be clipped. Pure so it can be tested without a layout engine.
 */
export function computeMenuPosition(
  trigger: Box,
  menu: MenuSize,
  viewport: { width: number; height: number },
  preferred: MenuPlacement,
): MenuPosition {
  const wantsTop = preferred.startsWith('top');
  const spaceBelow = viewport.height - trigger.bottom - GAP - EDGE;
  const spaceAbove = trigger.top - GAP - EDGE;
  const fitsPreferred = wantsTop ? spaceAbove >= menu.height : spaceBelow >= menu.height;
  const placeTop = fitsPreferred ? wantsTop : (wantsTop ? spaceBelow < spaceAbove : spaceAbove > spaceBelow);
  const alignEnd = preferred.endsWith('end');

  const room = placeTop ? spaceAbove : spaceBelow;
  const height = Math.min(menu.height, Math.max(room, 120));
  const rawTop = placeTop ? trigger.top - GAP - height : trigger.bottom + GAP;
  const rawLeft = alignEnd ? trigger.right - menu.width : trigger.left;
  const left = Math.max(EDGE, Math.min(rawLeft, viewport.width - EDGE - menu.width));
  const top = Math.max(EDGE, rawTop);
  return {
    left,
    top,
    placement: `${placeTop ? 'top' : 'bottom'}-${alignEnd ? 'end' : 'start'}` as MenuPlacement,
    maxHeight: Math.max(room, 120),
  };
}
