/** Pure overflow geometry for LabScrollArea. */

export interface OverflowEdges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

const EPSILON = 2;

/** Which edges of a scroller still have content beyond them (pure, testable). */
export function overflowEdges(el: Pick<HTMLElement, 'scrollLeft' | 'scrollTop' | 'scrollWidth' | 'scrollHeight' | 'clientWidth' | 'clientHeight'>): OverflowEdges {
  return {
    left: el.scrollLeft > EPSILON,
    right: el.scrollLeft + el.clientWidth < el.scrollWidth - EPSILON,
    top: el.scrollTop > EPSILON,
    bottom: el.scrollTop + el.clientHeight < el.scrollHeight - EPSILON,
  };
}

