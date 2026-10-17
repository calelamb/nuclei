import { describe, expect, it } from 'vitest';
import { isWebBuildTarget } from './resolveBuildTarget';

describe('isWebBuildTarget', () => {
  it('is web when BUILD_TARGET=web', () => {
    expect(isWebBuildTarget({ BUILD_TARGET: 'web' }, [])).toBe(true);
  });

  it('is desktop by default', () => {
    expect(isWebBuildTarget({}, ['node', 'vite', 'preview'])).toBe(false);
  });

  it('treats previewing the web output dir as web even without BUILD_TARGET', () => {
    // `npx vite preview --outDir dist-web` must serve under /try/ like the build.
    expect(isWebBuildTarget({}, ['vite', 'preview', '--outDir', 'dist-web'])).toBe(true);
    expect(isWebBuildTarget({}, ['vite', 'preview', '--outDir=dist-web/'])).toBe(true);
  });

  it('does not infer web from an unrelated dist-web mention outside preview', () => {
    expect(isWebBuildTarget({}, ['vite', 'build', '--outDir', 'dist-web'])).toBe(false);
  });

  it('lets an explicit non-web BUILD_TARGET win', () => {
    expect(isWebBuildTarget({ BUILD_TARGET: 'desktop' }, ['vite', 'preview', '--outDir', 'dist-web'])).toBe(false);
  });
});
