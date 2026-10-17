import { describe, it, expect } from 'vitest';
import { countLines, lessonEditorHeight, LESSON_EDITOR_MAX_HEIGHT, LESSON_EDITOR_MIN_HEIGHT } from './lessonEditorLayout';

describe('lessonEditorHeight', () => {
  it('grows with the code so nothing is cut off', () => {
    expect(lessonEditorHeight(10)).toBe(10 * 19 + 16);
  });

  it('has a floor for tiny snippets', () => {
    expect(lessonEditorHeight(1)).toBe(LESSON_EDITOR_MIN_HEIGHT);
  });

  it('caps very long code so the page keeps scrolling naturally', () => {
    expect(lessonEditorHeight(500)).toBe(LESSON_EDITOR_MAX_HEIGHT);
  });
});

describe('countLines', () => {
  it('counts lines', () => {
    expect(countLines('')).toBe(1);
    expect(countLines('a\nb\nc')).toBe(3);
  });
});
