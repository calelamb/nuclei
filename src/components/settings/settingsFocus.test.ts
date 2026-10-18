import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('settings section header focus ring', () => {
  it('is drawn inside the header so the clipped scroller cannot cut it to one edge', () => {
    const css = readFileSync(join(__dirname, 'settings.css'), 'utf8');
    expect(css).toMatch(/\.settings-section__header:focus-visible\s*\{[^}]*outline-offset:\s*-2px/);
    expect(readFileSync(join(__dirname, 'SettingsPrimitives.tsx'), 'utf8')).toContain('settings-section__header');
  });
});
