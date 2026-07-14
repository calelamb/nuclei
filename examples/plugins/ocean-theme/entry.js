/**
 * ocean-theme — a theme plugin.
 *
 * Registers a named colour set. Nuclei intersects these keys against its own
 * theme tokens (unknown keys are ignored), then the Plugins → Panels tab lets
 * the user Apply/Clear it. Available keys include: bg, bgPanel, bgElevated,
 * border, text, textMuted, accent, accentLight, dirac, success, warning, error.
 */
export function activate(api) {
  api.registerTheme({
    name: 'Ocean',
    colors: {
      bg: '#08131f',
      bgPanel: '#0b1a2b',
      bgElevated: '#102438',
      accent: '#00B4D8',
      accentLight: '#48cae4',
    },
  });

  api.log('ocean-theme registered');
}
