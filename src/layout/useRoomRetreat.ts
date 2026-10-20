import { useEffect, useRef, useState } from 'react';
import { useDiracPanelStore } from '../stores/diracPanelStore';
import { useNavigationStore } from '../stores/navigationStore';
import { noteDiracClaimedRoom } from '../hooks/sidebarFoldReason';
import { bandsForWidth, planRoom, shouldFoldDiracForSidebar } from './breakpoints';

interface RoomRetreatOptions {
  sidebarWidth: number;
  vizWanted: boolean;
  /** False while a full-width takeover is showing (folding the sidebar would drop it). */
  canCollapseSidebar: boolean;
  /** Whether the sidebar is showing right now; opening it by hand may fold Dirac. */
  sidebarOpen?: boolean;
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

/**
 * When Dirac opens (or the window shrinks) and the row gets tight, fold the sidebar first
 * so the editor keeps its minimum width and the circuit column survives; fold it back
 * when room returns. Keyed on Dirac and the viewport, never on the sidebar itself, so a
 * user who reopens the sidebar on purpose keeps it (the viz column then steps aside).
 * The other order is symmetrical: opening the sidebar on purpose while Dirac is open folds Dirac
 * to its rail tab when that is what keeps the editor at its minimum width.
 */
export function useRoomRetreat({ sidebarWidth, vizWanted, canCollapseSidebar, sidebarOpen = false }: RoomRetreatOptions): void {
  const viewport = useViewportWidth();
  const diracOpen = useDiracPanelStore((s) => s.isOpen);
  const diracWidth = useDiracPanelStore((s) => s.width);

  // Set when Dirac folded itself because the user opened the sidebar: that fold must not bounce the sidebar back out.
  const foldedForSidebar = useRef(false);
  const prevDiracOpen = useRef(diracOpen);

  useEffect(() => {
    const diracJustOpened = diracOpen && !prevDiracOpen.current;
    prevDiracOpen.current = diracOpen;
    if (foldedForSidebar.current) {
      foldedForSidebar.current = false;
      return;
    }
    // Dirac folds itself when the window enters the narrow band. Plan the room for the folded Dirac, so the
    // sidebar is not closed (and its content unmounted) only to be restored a moment later.
    const dirac = useDiracPanelStore.getState();
    const foldingNow = bandsForWidth(viewport).diracNarrow && dirac.lastNarrow === false;
    const plan = planRoom({ viewport, sidebarWidth, diracWidth: diracOpen && !foldingNow ? diracWidth : null, vizWanted });
    const nav = useNavigationStore.getState();
    if (plan.closeSidebar) {
      if (canCollapseSidebar && nav.activeView !== null) {
        if (diracJustOpened) noteDiracClaimedRoom();
        nav.retreatSidebarForRoom();
      }
    } else {
      nav.restoreSidebarForRoom();
    }
    // sidebarWidth / vizWanted / canCollapse are inputs to the plan but must not re-trigger a fold the user undid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, diracOpen, diracWidth]);

  const wasSidebarOpen = useRef(sidebarOpen);
  useEffect(() => {
    const opened = sidebarOpen && !wasSidebarOpen.current;
    wasSidebarOpen.current = sidebarOpen;
    if (!opened) return;
    const { isOpen, width, close } = useDiracPanelStore.getState();
    if (isOpen && shouldFoldDiracForSidebar({ viewport, sidebarWidth, diracWidth: width })) {
      foldedForSidebar.current = true;
      close();
    }
    // Only the sidebar opening matters; viewport / width are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarOpen]);
}
