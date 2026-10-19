import { Fragment, type ReactElement } from 'react';

/** Renders a project path that may wrap only after a slash (never mid-segment unless one segment is wider than the box). */
export function PathText({ path }: { path: string }): ReactElement {
  const segments = path.split('/');
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={`${index}:${segment}`}>
          {segment}
          {index < segments.length - 1 && <>/<wbr /></>}
        </Fragment>
      ))}
    </>
  );
}
