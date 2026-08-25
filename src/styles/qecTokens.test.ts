import { describe, expect, it } from 'vitest';
import { QEC_LIGHT_TOKENS } from './qecTokens';

function relativeLuminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  const linear = channels.map((value) => value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(left: string, right: string): number {
  const values = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('QEC light tokens', () => {
  it('uses white/light-blue surfaces and no dark navy values', () => {
    expect(QEC_LIGHT_TOKENS.canvas).toBe('#FFFFFF');
    expect(QEC_LIGHT_TOKENS.selection).toBe('#E0F2FE');
    expect(Object.values(QEC_LIGHT_TOKENS)).not.toContain('#0F1B2D');
  });

  it.each(['canvas', 'raised', 'recessed', 'field', 'selection'] as const)(
    'keeps muted normal text above 4.5:1 on the %s surface',
    (surface) => expect(contrast(QEC_LIGHT_TOKENS.textMuted, QEC_LIGHT_TOKENS[surface]))
      .toBeGreaterThanOrEqual(4.5),
  );

  it('keeps the enabled create action above 4.5:1', () => {
    expect(contrast(QEC_LIGHT_TOKENS.canvas, QEC_LIGHT_TOKENS.action)).toBeGreaterThanOrEqual(4.5);
  });
});
