const END_SLACK = 2;

/** True while content remains below the visible area of a scroll container. */
export function hasMoreBelow(m: { scrollTop: number; clientHeight: number; scrollHeight: number }): boolean {
  return m.scrollHeight - m.clientHeight - m.scrollTop > END_SLACK;
}
