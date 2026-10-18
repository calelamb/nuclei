// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as buildTarget from '../../../platform/buildTarget';
import { useSourcesRail } from './useSourcesRail';

afterEach(() => vi.restoreAllMocks());

describe('useSourcesRail on the web build (qec-r-53)', () => {
  it('starts folded even on a wide window, since the panel holds only a sentence', () => {
    vi.spyOn(buildTarget, 'isWebBuild').mockReturnValue(true);
    expect(renderHook(() => useSourcesRail()).result.current.collapsed).toBe(true);
  });

  it('stays expanded on a wide desktop window', () => {
    vi.spyOn(buildTarget, 'isWebBuild').mockReturnValue(false);
    expect(renderHook(() => useSourcesRail()).result.current.collapsed).toBe(false);
  });
});
