import { useEffect, useState } from 'react';

/**
 * Whether the pane split has landed on its first real size. The split's width
 * transition is for drags and later changes; animating the jump from the default
 * to the saved width on launch looks like the window rearranging itself. Flips to
 * true two frames after `ready` (so the settled width has painted) and stays true.
 */
export function useLayoutSettled(ready: boolean): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!ready || settled) return undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSettled(true));
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [ready, settled]);
  return settled;
}
