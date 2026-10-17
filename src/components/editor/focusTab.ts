/** Focuses the open tab for `path` once it has rendered active (used after picking a file from the overflow menu). */
export function focusTabForPath(path: string): void {
  window.requestAnimationFrame(() => {
    const tabs = document.querySelectorAll<HTMLElement>('[role="tab"][data-tab-path]');
    Array.from(tabs).find((el) => el.dataset.tabPath === path)?.focus();
  });
}
