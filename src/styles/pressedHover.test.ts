import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Component CSS is unlayered and beats the primitives layer, so a pressed toggle that
// restyles its background must also restyle its hover or the hover state disappears.
const cases: Array<[string, RegExp]> = [
  ['components/qec/workbench/qecWorkbench.css', /\.qec-panel-pin\.nuclei-icon-btn\[aria-pressed='true'\]:hover:not\(:disabled\)\s*\{[^}]*background/],
  ['components/qec/qecAnalysis.css', /\.qec-toggle-btn\.nuclei-btn\[aria-pressed='true'\]:hover:not\(:disabled\)\s*\{[^}]*background/],
  ['components/learning/lessonBlocks.css', /\.bsphere__chips \.nuclei-btn\[aria-pressed='true'\]:hover:not\(:disabled\)\s*\{[^}]*background/],
];

describe('pressed toggles keep a hover state under @layer', () => {
  it.each(cases)('%s', (file, rule) => {
    expect(readFileSync(join(__dirname, '..', file), 'utf8')).toMatch(rule);
  });
});
