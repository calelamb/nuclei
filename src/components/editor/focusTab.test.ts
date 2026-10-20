// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { focusTabForPath } from './focusTab';

describe('focusTabForPath', () => {
  it('focuses the tab whose path matches, even with special characters', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
    document.body.innerHTML = '<div role="tab" tabindex="-1" data-tab-path="/a/b [1].py"></div><div role="tab" tabindex="-1" data-tab-path="/c.py"></div>';
    focusTabForPath('/a/b [1].py');
    expect(document.activeElement?.getAttribute('data-tab-path')).toBe('/a/b [1].py');
    vi.unstubAllGlobals();
  });
});
