import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Shared selectors: a later no-restricted-syntax block replaces (not extends) an earlier one,
// so every block spreads these instead of restating them.
const fontRules = [
  {
    selector: "Property[key.name='fontFamily'] > Literal[value=/(Geist|JetBrains|Fira|Inter|monospace|sans-serif|system-ui)/]",
    message: 'Use TYPOGRAPHY.fontSans / TYPOGRAPHY.fontMono from src/styles/tokens instead of a literal font stack.',
  },
  {
    selector: "JSXAttribute[name.name='fontFamily'] > Literal",
    message: 'Use fontFamily={TYPOGRAPHY.fontSans} / fontMono instead of a literal font stack.',
  },
]

export default defineConfig([
  globalIgnores([
    'coverage',
    'dist',
    'dist-web',
    'dist-vercel',
    'docs-site',
    'node_modules',
    'src-tauri/target',
    'test-results',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Design-system guard: fonts come from TYPOGRAPHY / var(--font-*), never literals.
    // src/components/experiments is exempt until its lane migrates (index.css aliases 'Fira Code').
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/styles/**', 'src/components/experiments/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...fontRules,
      ],
    },
  },
  {
    // Chrome lanes own their colours: hex literals are banned in favour of theme tokens
    // (useThemeStore colors / var(--color-*)). Restates the font rules because a later
    // no-restricted-syntax block replaces, not extends, the earlier one.
    files: [
      'src/components/{explorer,settings,hardware,layout,editor,educator,commandPalette,onboarding,ui,community,transpiler}/**/*.{ts,tsx}',
      'src/components/qec/VizZone.tsx',
    ],
    ignores: ['**/*.test.{ts,tsx}', 'src/components/editor/monacoThemes.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...fontRules,
        {
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message: 'No hex colours in chrome components: use theme tokens (colors.* from useThemeStore, or var(--color-*)).',
        },
        {
          selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{6}/]',
          message: 'No hex colours in chrome components: use theme tokens (colors.* from useThemeStore, or var(--color-*)).',
        },
      ],
    },
  },
])
