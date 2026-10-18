import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QEC_LIGHT_TOKENS } from './qecTokens';
import { QEC_WORKBENCH_DIMENSIONS } from '../stores/qecWorkbenchStore';

const qecStyles = readFileSync(
  resolve(process.cwd(), 'src/components/qec/workbench/qecWorkbench.css'),
  'utf8',
);
const responsiveStyles = readFileSync(
  resolve(process.cwd(), 'src/components/qec/workbench/qecWorkbenchResponsive.css'),
  'utf8',
);
const mainSource = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');

describe('QEC type scale (design-r-16)', () => {
  const wizardStyles = readFileSync(
    resolve(process.cwd(), 'src/components/qec/import/qecImportWizard.css'),
    'utf8',
  );

  it.each([
    ['qecWorkbench.css', qecStyles],
    ['qecImportWizard.css', wizardStyles],
  ])('uses the type-scale tokens, not pixel literals, in %s', (_name, css) => {
    expect(css.match(/font-size:\s*\d+(\.\d+)?px/g) ?? []).toEqual([]);
  });
});

describe('QEC workbench CSS tokens', () => {
  it('aliases surfaces, text and status colours to the global tokens instead of redefining them (design-r-12)', () => {
    for (const pair of [
      ['--qec-text', '--color-text-primary'], ['--qec-text-muted', '--color-text-secondary'],
      ['--qec-border', '--color-border-strong'], ['--qec-raised', '--color-surface-raised'],
      ['--qec-danger', '--color-danger'], ['--qec-success', '--color-success'], ['--qec-warning', '--color-warning'],
    ]) expect(qecStyles).toMatch(new RegExp(`${pair[0]}: var\\(${pair[1]}`));
    expect(qecStyles).not.toMatch(/--qec-text-muted: #/);
  });

  it('keeps headings at 600 and drops the shouting eyebrows (design-r-04)', () => {
    expect(qecStyles).not.toMatch(/font-weight: 700/);
    expect(qecStyles).not.toMatch(/letter-spacing: 0\.0[6-9]em/);
  });

  it('carries no dead action custom properties and lets the shared primary Button style the Study create action', () => {
    expect(qecStyles).not.toContain('--qec-action');
    expect(qecStyles).not.toContain('.qec-study-create-button');
  });

  it('defines exact light, responsive, overflow, focus, and reduced-motion contracts', () => {
    expect(qecStyles).toContain('--qec-canvas: var(--color-surface-base, #ffffff)');
    expect(qecStyles).toContain('--qec-recessed: var(--color-surface-sunken, #f1f5f9)');
    expect(qecStyles).toMatch(/--qec-analytical: var\(--color-accent-quantum/);
    expect(qecStyles).toMatch(/\.qec-workbench\s*{[\s\S]*?overflow: hidden;/);
    expect(responsiveStyles).toMatch(
      /@media \(max-width: 1179px\)[\s\S]*?\.qec-inspector\s*{[\s\S]*?position: absolute;/,
    );
    expect(responsiveStyles).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.qec-tray--collapsed\s*{[\s\S]*?height: 45px;/,
    );
    expect(responsiveStyles).toContain('@media (max-width: 699px)');
    expect(qecStyles).toMatch(/\.qec-inspector\[hidden\]\s*{[\s\S]*?display: none;/);
    expect(qecStyles).toContain('outline: var(--focus-ring-width) solid var(--focus-ring-color)');
    expect(responsiveStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition-duration: 0\.01ms !important;/,
    );
  });

  it('loads the focused responsive stylesheet after the base workbench styles', () => {
    expect(mainSource).toMatch(
      /import '\.\/components\/qec\/workbench\/qecWorkbench\.css'\s*\nimport '\.\/components\/qec\/workbench\/qecWorkbenchResponsive\.css'/,
    );
  });

  it('maps the persisted 180–520 px tray contract directly to rendered height', () => {
    expect(QEC_WORKBENCH_DIMENSIONS.tray).toEqual({ min: 180, max: 520 });
    expect(qecStyles).toMatch(/\.qec-tray--expanded\s*{[^}]*height: var\(--qec-tray-height\);/);
    expect(qecStyles).not.toMatch(/\.qec-tray--expanded\s*{[^}]*height: min\(/);
  });
});
