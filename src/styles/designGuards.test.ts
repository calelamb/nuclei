import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(tsx?|css)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

const files = walk(SRC)
  .map((p) => ({ rel: relative(SRC, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }));


function offenders(test: (f: { rel: string; text: string }) => boolean): string[] {
  return files.filter(test).map((f) => f.rel);
}

describe('design guards', () => {
  it('never hard-codes the ⌘ glyph in shell chrome; labels come from config/keybindings so Windows says Ctrl', () => {
    const shell = (f: { rel: string }) => /^components\/(layout|ui|commandPalette|settings|onboarding|transpiler|editor\/inlineEdit)\//.test(f.rel);
    const code = (text: string) => text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n');
    expect(offenders((f) => shell(f) && /⌘/.test(code(f.text)))).toEqual([]);
  });

  it('has no inline outline:none that would hide the shared focus ring', () => {
    expect(offenders((f) => /outline:\s*['"]none['"]/.test(f.text))).toEqual([]);
  });

  it('never loads fonts from a CDN (desktop CSP blocks them)', () => {
    expect(offenders((f) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(f.text))).toEqual([]);
  });

  it('has no references to fonts that are not shipped (Fira Code, Inter, JetBrains Mono)', () => {
    expect(offenders((f) => !f.rel.startsWith('index.css') && /Fira Code|JetBrains Mono|\bInter\b,|'Inter'/.test(f.text))).toEqual([]);
  });

  it('has no unshipped font weights (650/750/800)', () => {
    expect(offenders((f) => /font-?[wW]eight['"]?:\s*(650|750|800)\b/.test(f.text))).toEqual([]);
  });

  it('has no hard-coded onboarding gradient end colour', () => {
    expect(offenders((f) => /#080E18/i.test(f.text))).toEqual([]);
  });

  it('does not paint accent buttons with panel-coloured text (fails AA in light theme); use <Button variant="primary">', () => {
    expect(offenders((f) => /background:\s*colors\.accent,\s*color:\s*colors\.bgPanel/.test(f.text))).toEqual([]);
  });

  it('keeps JSX icon sizes on the 12/14/16/20 scale', () => {
    expect(offenders((f) => /<[A-Za-z.]*(Icon|Icon\w*)\s[^>]*size=\{(9|10|11|13|15|17|18)\}/.test(f.text) || /<(Icon|MIcon|stat\.icon)\s[^>]*size=\{(9|10|11|13|15)\}/.test(f.text))).toEqual([]);
  });

  it('keeps the research trees (experiments, qec) on the 11px minimum type size and CSS hover states', () => {
    const research = (f: { rel: string }) => /^components\/(experiments|qec)\//.test(f.rel);
    expect(offenders((f) => research(f) && /fontSize:\s*(?:[1-9]|10)(?:\.5)?\b(?!\s*[%a-z])/.test(f.text) && !/<svg/.test(f.text))).toEqual([]);
    expect(offenders((f) => research(f) && /currentTarget\.style\./.test(f.text))).toEqual([]);
  });

  it('has no purple (Dirac) colours in the research trees', () => {
    expect(offenders((f) => /^components\/(experiments|qec)\//.test(f.rel) && /colors\.dirac\b/.test(f.text))).toEqual([]);
  });

  it('uses accentText (not the raw teal fill colour) for text outside the trees other lanes still own', () => {
    // Raw accent teal fails AA as small text on white; fills and borders may still use it.
    // learning/challenges/community are clean and guarded; experiments/qec stay exempt until the research lane lands.
    const pending = /^components\/(experiments|markdown|qec)\/|^components\/hardware\/(HardwarePanel|LaunchPortal)\.tsx$/;
    const rawAccentText = /(?<![-\w])color:\s*(?:colors\.accent\b(?!Text|Light)|var\(--color-accent-quantum\))/;
    expect(offenders((f) => !pending.test(f.rel) && rawAccentText.test(f.text))).toEqual([]);
  });

  it('renders every lucide icon at the shared stroke weight', async () => {
    const { ICON_STROKE } = await import('./tokens');
    const css = files.find((f) => f.rel === 'index.css')?.text ?? '';
    expect(css).toMatch(new RegExp(`\\.lucide\\s*\\{\\s*stroke-width:\\s*${ICON_STROKE}\\s*;`));
  });

  it('opts heavy glyphs in by class (nuclei-icon--bold), not by a strokeWidth prop the global rule would override', () => {
    const owned = (f: { rel: string }) => /^components\/(ui|learning|challenges|community|settings|onboarding)\//.test(f.rel);
    expect(offenders((f) => owned(f) && /<(Check|X|Minus)\b[^>]*strokeWidth=\{[2-9]/.test(f.text))).toEqual([]);
    const css = files.find((f) => f.rel === 'index.css')?.text ?? '';
    expect(css).toMatch(/\.lucide\.nuclei-icon--bold\s*\{/);
  });

  it('uses the single overline tracking (0.04em) in the Learn, challenge, community, settings and onboarding trees', () => {
    const owned = (f: { rel: string }) => /^components\/(learning|challenges|community|settings|onboarding)\//.test(f.rel);
    expect(offenders((f) => owned(f) && (/letterSpacing:\s*0\.[45]\b(?!\s*\w)/.test(f.text) || /letter-spacing:\s*0\.[45]px/.test(f.text)))).toEqual([]);
  });

  it('draws modal backdrops with the scrim token, not a hard-coded black', () => {
    const modalFiles = ['components/onboarding/KeyboardShortcuts.tsx', 'components/commandPalette/CommandPalette.tsx', 'components/ui/Dialog.tsx'];
    expect(offenders((f) => modalFiles.includes(f.rel) && /background:\s*['"]rgba\(0,\s*0,\s*0/.test(f.text))).toEqual([]);
  });

  it('declares color-scheme for both themes so native checkboxes, selects and scrollbars follow the app theme', () => {
    const css = files.find((f) => f.rel === 'styles/tokens.css')?.text ?? '';
    const block = (selector: RegExp) => css.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(block(/:root,\s*:root\[data-theme='dark'\]/)).toMatch(/color-scheme:\s*dark\s*;/);
    expect(block(/:root\[data-theme='light'\]/)).toMatch(/color-scheme:\s*light\s*;/);
  });

  it('draws a focused choice card as one band: the border takes the ring colour, no pale border between ring and accent stripe', () => {
    const css = files.find((f) => f.rel === 'components/ui/ui.css')?.text ?? '';
    const rule = css.match(/\.nuclei-choice-card:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/border-color:\s*var\(--focus-ring-color\)/);
    expect(rule).not.toMatch(/border-color:\s*var\(--color-border-subtle\)/);
    // The inset stripe takes the ring colour too, so the left edge is one colour rather than the accent inside the ring.
    expect(rule).toMatch(/inset 3px 0 0 var\(--focus-ring-color\)/);
    expect(rule).not.toMatch(/--choice-accent/);
  });

  it('balances the lines of centred empty-state copy', () => {
    const css = files.find((f) => f.rel === 'components/ui/ui.css')?.text ?? '';
    expect(css.match(/\.nuclei-empty__body\s*\{([^}]*)\}/)?.[1] ?? '').toMatch(/text-wrap:\s*balance/);
  });

  it('does not add raw <input> elements outside ui/ (use TextInput, SearchField, SecretField, Checkbox); existing ones only shrink', () => {
    // Ratchet: the audit counted five input looks. Files below still hold range/file/radio inputs or bare-bar
    // inputs (palette, tab rename, inline edit) that other lanes own; a count may fall, never rise.
    const allowed: Record<string, number> = {
      'components/ui/TextInput.tsx': 1,
      'components/ui/Checkbox.tsx': 1,
      'components/settings/SettingsPanel.tsx': 1, // the parse-debounce range slider
      'components/hardware/LaunchPortal.tsx': 1,
      'components/hardware/CredentialSetup.tsx': 1,
      'components/layout/BottomPanel.tsx': 1,
      'components/educator/AssignmentCreator.tsx': 2,
      'components/educator/ClassroomPanel.tsx': 2,
      'components/learning/InteractiveBlochSphere.tsx': 2,
      'components/commandPalette/CommandPalette.tsx': 1,
      'components/qec/CodeLatticePanel.tsx': 1,
      'components/qec/QecCsvDropZone.tsx': 2,
      'components/community/CircuitGallery.tsx': 1,
      'components/explorer/ExplorerNameInput.tsx': 1, // the inline create/rename field (was two in FileExplorer)
      'components/editor/inlineEdit/InlineEditWidget.tsx': 1,
      'components/community/UserProfile.tsx': 1,
      'components/editor/EditorTabStrip.tsx': 1,
      'components/qec/import/QecImportWizard.tsx': 1,
    };
    const over = files
      .filter((f) => f.rel.endsWith('.tsx'))
      .map((f) => ({ rel: f.rel, count: (f.text.match(/<input\b/g) ?? []).length }))
      .filter((f) => f.count > (allowed[f.rel] ?? 0))
      .map((f) => `${f.rel}: ${f.count} > ${allowed[f.rel] ?? 0}`);
    expect(over).toEqual([]);
  });

  it('keeps search/filter fields off the hand-rolled field-group look (Glossary, Challenges use SearchField)', () => {
    expect(offenders((f) => /^components\/(learning|challenges|settings)\//.test(f.rel) && /nuclei-field-group|nuclei-bare-input/.test(f.text))).toEqual([]);
  });

  it('gives a field group exactly one focus indicator: the wrapper ring, not the bare-input underline too', () => {
    const css = files.find((f) => f.rel === 'components/ui/ui.css')?.text ?? '';
    expect(css).toMatch(/\.nuclei-field-group\s*>\s*\.nuclei-bare-input:focus-visible\s*\{[^}]*box-shadow:\s*none/);
  });

  it('never paints text in var(--color-danger) in a stylesheet that washes a surface in danger; text on the wash needs --color-danger-text (AA)', () => {
    const offending = files
      .filter((f) => f.rel.endsWith('.css'))
      .filter((f) => /background[^;]*color-mix\([^;]*var\(--color-danger\)/.test(f.text) && /(?:^|[;{\s])color:\s*var\(--color-danger\)\s*[;}]/.test(f.text))
      .map((f) => f.rel);
    expect(offending).toEqual([]);
  });

  it('resolves every var(--x): a custom property used without a fallback is declared somewhere', () => {
    const all = files.map((f) => f.text).join('\n');
    const declared = (name: string) => new RegExp(`${name}\\s*:|['"\`]${name}['"\`]|${name}\\$\\{|setProperty\\(\\s*['"]${name}`).test(all);
    const used = new Set<string>();
    for (const f of files) {
      for (const m of f.text.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) used.add(m[1]);
    }
    const undeclared = [...used].filter((name) => !declared(name)).sort();
    expect(undeclared).toEqual([]);
  });

  it('gives every landing attribute used in markup the one shared no-ring rule in ui.css', () => {
    const css = files.find((f) => f.rel === 'components/ui/ui.css')?.text ?? '';
    const used = new Set<string>();
    for (const f of files.filter((x) => /\.(tsx?)$/.test(x.rel))) {
      for (const m of f.text.matchAll(/\bdata-(?:nav-|viz-)?landing\b|\bdata-nav-landed\b|(?:VIZ|NAV)_LANDING_ATTR\s*=\s*'(data-[\w-]+)'/g)) {
        used.add(m[1] ?? m[0]);
      }
    }
    expect([...used].length).toBeGreaterThan(0);
    const missing = [...used].filter((attr) => !new RegExp(`\\[${attr}\\]`).test(css));
    expect(missing).toEqual([]);
  });

  it('keeps landing no-ring rules out of feature stylesheets', () => {
    expect(offenders((f) => f.rel.endsWith('.css') && f.rel !== 'components/ui/ui.css' && /\[data-(?:nav-|viz-)?landing\]:/.test(f.text))).toEqual([]);
  });

  it('dims stale result graphics with the one --stale-graphic-opacity token, not per-surface literals', () => {
    const demo = files.find((f) => f.rel === 'components/learning/demo.css')?.text ?? '';
    expect(demo).not.toMatch(/exercise__output-lines\s*\{[^}]*opacity/);
    for (const rel of ['components/learning/demo.css', 'components/layout/vizRail.css', 'components/bloch/bloch.css']) {
      const text = files.find((f) => f.rel === rel)?.text ?? '';
      expect(text, rel).toMatch(/opacity:\s*var\(--stale-graphic-opacity\)/);
    }
    const stale = files.filter((f) => f.rel.endsWith('.css')).flatMap((f) => (f.text.match(/[^{}]*stale[^{}]*\{[^}]*opacity:\s*0?\.\d+[^}]*\}/g) ?? []).map((r) => `${f.rel}: ${r.trim()}`));
    expect(stale).toEqual([]);
  });
});
