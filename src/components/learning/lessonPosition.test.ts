// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { recallLessonBlock, rememberLessonBlock } from './lessonPosition';

beforeEach(() => sessionStorage.clear());

describe('lessonPosition', () => {
  it('round trips a block per lesson', () => {
    rememberLessonBlock('a', 4);
    rememberLessonBlock('b', 2);
    expect(recallLessonBlock('a', 10)).toBe(4);
    expect(recallLessonBlock('b', 10)).toBe(2);
  });

  it('forgets the place at block 0 and ignores out-of-range or corrupt values', () => {
    rememberLessonBlock('a', 4);
    rememberLessonBlock('a', 0);
    expect(recallLessonBlock('a', 10)).toBeNull();
    rememberLessonBlock('a', 12);
    expect(recallLessonBlock('a', 10)).toBeNull();
    sessionStorage.setItem('nuclei-lesson-position', '{not json');
    expect(recallLessonBlock('a', 10)).toBeNull();
  });
});
