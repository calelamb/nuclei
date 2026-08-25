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

describe('QEC workbench CSS tokens', () => {
  it('uses the shared action custom property for the Study create action', () => {
    expect(qecStyles).toContain(`--qec-action: ${QEC_LIGHT_TOKENS.action.toLowerCase()}`);
    expect(qecStyles).toMatch(
      /\.qec-study-create-button:not\(:disabled\)\s*{[^}]*background: var\(--qec-action\)/,
    );
  });

  it('defines exact light, responsive, overflow, focus, and reduced-motion contracts', () => {
    expect(qecStyles).toContain('--qec-canvas: #ffffff');
    expect(qecStyles).toContain('--qec-recessed: #f1f5f9');
    expect(qecStyles).toContain('--qec-analytical: #2563eb');
    expect(qecStyles).toMatch(/\.qec-workbench\s*{[\s\S]*?overflow: hidden;/);
    expect(responsiveStyles).toMatch(
      /@media \(max-width: 1179px\)[\s\S]*?\.qec-inspector\s*{[\s\S]*?position: absolute;/,
    );
    expect(responsiveStyles).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.qec-tray--collapsed\s*{[\s\S]*?height: 45px;/,
    );
    expect(responsiveStyles).toContain('@media (max-width: 699px)');
    expect(qecStyles).toMatch(/\.qec-inspector\[hidden\]\s*{[\s\S]*?display: none;/);
    expect(qecStyles).toContain('outline: 2px solid var(--qec-analytical)');
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
