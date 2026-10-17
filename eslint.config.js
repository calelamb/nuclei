import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

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
        {
          selector: "Property[key.name='fontFamily'] > Literal[value=/(Geist|JetBrains|Fira|Inter|monospace|sans-serif|system-ui)/]",
          message: 'Use TYPOGRAPHY.fontSans / TYPOGRAPHY.fontMono from src/styles/tokens instead of a literal font stack.',
        },
        {
          selector: "JSXAttribute[name.name='fontFamily'] > Literal",
          message: 'Use fontFamily={TYPOGRAPHY.fontSans} / fontMono instead of a literal font stack.',
        },
      ],
    },
  },
])
