// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RunHistogram } from './RunHistogram';

describe('RunHistogram chart sizing (research-r-15)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('mounts without recharts reporting a zero or negative chart size', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<RunHistogram measurements={{ '00': 512, '11': 512 }} />);
    const messages = [...warn.mock.calls, ...error.mock.calls].map((call) => call.map(String).join(' '));
    expect(messages.filter((m) => /width\(-?\d+\) and height\(-?\d+\) of chart/.test(m))).toEqual([]);
  });
});
