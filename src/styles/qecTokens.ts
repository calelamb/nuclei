export const QEC_LIGHT_TOKENS = Object.freeze({
  canvas: '#FFFFFF',
  raised: '#F8FAFC',
  recessed: '#F1F5F9',
  border: '#E2E8F0',
  text: '#1A1A2E',
  textMuted: '#64748B',
  quantum: '#0891B2',
  interactive: '#00B4D8',
  analytical: '#2563EB',
  field: '#F0F9FF',
  selection: '#E0F2FE',
  selectionStrong: '#BAE6FD',
} as const);

export type QecLightToken = keyof typeof QEC_LIGHT_TOKENS;
