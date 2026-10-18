// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { focusAfterUnmount } from './focusAfterUnmount';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

function mount(html: string) { document.body.innerHTML = html; }

describe('focusAfterUnmount', () => {
  it('moves focus to the first existing target once the origin unmounts', () => {
    mount('<button id="origin">x</button><button id="chip">Expand histogram</button>');
    const origin = document.getElementById('origin') as HTMLElement;
    origin.focus();
    focusAfterUnmount(origin, ['#missing', '#chip']);
    origin.remove();
    vi.advanceTimersByTime(100);
    expect(document.activeElement?.id).toBe('chip');
    expect(document.activeElement).not.toBe(document.body);
  });

  it('waits while the origin is still mounted (exit animation) and leaves focus alone', () => {
    mount('<button id="origin">x</button><button id="chip">c</button>');
    const origin = document.getElementById('origin') as HTMLElement;
    origin.focus();
    focusAfterUnmount(origin, ['#chip']);
    vi.advanceTimersByTime(1000);
    expect(document.activeElement).toBe(origin);
  });

  it('does not steal focus the person moved elsewhere', () => {
    mount('<button id="origin">x</button><input id="other"><button id="chip">c</button>');
    const origin = document.getElementById('origin') as HTMLElement;
    origin.focus();
    focusAfterUnmount(origin, ['#chip']);
    (document.getElementById('other') as HTMLElement).focus();
    origin.remove();
    vi.advanceTimersByTime(100);
    expect(document.activeElement?.id).toBe('other');
  });
});
