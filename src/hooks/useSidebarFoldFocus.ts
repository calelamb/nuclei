import { useEffect } from 'react';
import { useNavigationStore } from '../stores/navigationStore';
import { focusAfterUnmount } from './focusAfterUnmount';

const SIDEBAR_SELECTOR = '[data-tour-sidebar]';

/**
 * When the window shrinks and the sidebar folds away on its own while focus is inside it, focus
 * lands on that view's activity-bar button (the control that brings it back) instead of <body>.
 * Folding by hand (the person pressed the rail button) already has focus there and is left alone.
 */
export function useSidebarFoldFocus(): void {
  useEffect(() => {
    let focusedInSidebar: HTMLElement | null = null;
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      focusedInSidebar = target?.closest(SIDEBAR_SELECTOR) ? target : null;
    };
    document.addEventListener('focusin', onFocusIn);
    const unsubscribe = useNavigationStore.subscribe((state, prev) => {
      const folded = prev.activeView !== null && state.activeView === null && state.autoCollapsedView !== null;
      if (!folded || !focusedInSidebar || !document.contains(focusedInSidebar)) return;
      focusAfterUnmount(focusedInSidebar, [`[data-tour-target="activity-${prev.activeView}"]`]);
      focusedInSidebar = null;
    });
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      unsubscribe();
    };
  }, []);
}
