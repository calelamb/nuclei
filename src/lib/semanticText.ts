/**
 * Success-coloured *text*. The success fill (#059669 in light) is only 3.8:1 on
 * the light surface, so small text uses the dedicated text token when the theme
 * defines it and otherwise a darkened mix that always clears AA.
 */
export const SUCCESS_TEXT =
  'var(--color-success-text, color-mix(in srgb, var(--color-success) 55%, var(--color-text-primary)))';
