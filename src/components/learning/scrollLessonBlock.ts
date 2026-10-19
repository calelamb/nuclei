/**
 * Scrolls a lesson block to the top of the lesson reader. Targets the .lesson__scroll container
 * directly: Element.scrollIntoView also scrolls every ancestor (including <html>), which shoves the
 * whole app off the top of the window.
 */
export function scrollLessonBlock(index: number, behavior: ScrollBehavior): void {
  const block = document.getElementById(`block-${index}`);
  const scroller = block?.closest<HTMLElement>('.lesson__scroll');
  if (!block || !scroller) return;
  const top = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTo({ top, behavior });
}
