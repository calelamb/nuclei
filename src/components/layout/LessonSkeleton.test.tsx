// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LessonSkeleton } from './LessonSkeleton';

afterEach(cleanup);

describe('LessonSkeleton (learn-r6-02)', () => {
  it('is a labelled status shaped like a lesson: a title, text bars and an editor block', () => {
    const { getByRole, container } = render(<LessonSkeleton />);
    expect(getByRole('status', { name: 'Loading lesson' })).toBeTruthy();
    expect(container.querySelectorAll('.lesson-skeleton__bar')).toHaveLength(5);
    expect(container.querySelector('.lesson-skeleton__editor')).toBeTruthy();
  });

  it('stops pulsing for reduced motion and uses no literal colours', () => {
    const css = readFileSync(join(__dirname, 'lessonSkeleton.css'), 'utf8');
    expect(css).toMatch(/prefers-reduced-motion[^{]*\{[^}]*animation:\s*none/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
