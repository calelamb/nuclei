import './lessonSkeleton.css';

/**
 * What the Learn and Challenge panes show while their lazy chunk loads: the
 * shape of a lesson (title, two text lines, an editor block) so a slow
 * connection reads as "loading" instead of a blank window.
 */
export function LessonSkeleton() {
  return (
    <div className="lesson-skeleton" role="status" aria-label="Loading lesson">
      <div className="lesson-skeleton__text">
        <span className="lesson-skeleton__bar lesson-skeleton__bar--title" />
        <span className="lesson-skeleton__bar" />
        <span className="lesson-skeleton__bar lesson-skeleton__bar--short" />
      </div>
      <div className="lesson-skeleton__editor" />
    </div>
  );
}
