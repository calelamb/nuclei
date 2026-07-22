import { describe, expect, it } from 'vitest';
import { QEC_LIGHT_TOKENS } from './qecTokens';

describe('QEC light tokens', () => {
  it('uses white/light-blue surfaces and no dark navy values', () => {
    expect(QEC_LIGHT_TOKENS.canvas).toBe('#FFFFFF');
    expect(QEC_LIGHT_TOKENS.selection).toBe('#E0F2FE');
    expect(Object.values(QEC_LIGHT_TOKENS)).not.toContain('#0F1B2D');
  });
});
