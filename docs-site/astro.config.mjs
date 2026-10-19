// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

// Nuclei developer docs — served at https://getnuclei.dev/docs
// (nuclei.dev appears in older copy but has no DNS today; switch `site`
// back if that domain ever goes live.)
// Built standalone (own package.json) and copied into dist-vercel/docs/
// by scripts/build-vercel.sh.
export default defineConfig({
  site: 'https://getnuclei.dev',
  base: '/docs',
  integrations: [
    starlight({
      title: 'Nuclei',
      // Brand mark (ket |n>). Starlight renders it as <img>, so currentColor
      // would not inherit: ship fixed ink / near-white stroke variants per theme.
      logo: {
        light: './src/assets/nuclei-mark.svg',
        dark: './src/assets/nuclei-mark-dark.svg',
        alt: 'Nuclei',
        replacesTitle: false,
      },
      description:
        'Developer and researcher documentation for Nuclei — the open-source quantum computing IDE.',
      favicon: '/favicon.svg',
      head: [
        // Starlight already emits og:title/og:description/og:url per page;
        // add the Twitter card type so shares render a summary card.
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary' },
        },
      ],
      plugins: [
        // Fails `astro build` on any broken internal link or anchor,
        // so broken links can never reach a deploy (CI runs this build).
        starlightLinksValidator(),
      ],
      components: {
        // Default the docs to the light paper theme on first visit to match
        // the research-first "textbook" marketing site. Keeps the full
        // auto/light/dark picker; user choice still persists.
        ThemeProvider: './src/components/ThemeProvider.astro',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/calelamb/nuclei' },
      ],
      customCss: [
        // Self-hosted fonts (no render-blocking Google Fonts requests).
        // Textbook look: Newsreader headings, Hanken Grotesk body/UI,
        // JetBrains Mono code.
        '@fontsource/newsreader/400.css',
        '@fontsource/newsreader/500.css',
        '@fontsource/newsreader/600.css',
        '@fontsource/newsreader/400-italic.css',
        '@fontsource/hanken-grotesk/400.css',
        '@fontsource/hanken-grotesk/500.css',
        '@fontsource/hanken-grotesk/600.css',
        '@fontsource/jetbrains-mono/400.css',
        '@fontsource/jetbrains-mono/500.css',
        '@fontsource/jetbrains-mono/600.css',
        // Nuclei theme overrides.
        './src/styles/nuclei.css',
      ],
      sidebar: [
        { label: 'Docs Home', link: '/' },
        {
          label: 'Introduction',
          items: [
            'introduction/architecture',
            'introduction/install-and-build',
            'introduction/desktop-vs-web',
            'introduction/kernel-troubleshooting',
          ],
        },
        {
          label: 'Research',
          items: [
            'research/workspace-modes',
            'research/navigating-the-workspace',
            'research/experiments',
            'research/qec-studio',
            'research/qec-workbench',
            'research/qec-data-import',
            'research/plot-a-sinter-csv',
            'research/campaigns',
            'research/noise-models',
            'research/resource-estimation',
            'research/reproducibility',
          ],
        },
        {
          label: 'Developer Tools',
          items: [
            'developer-tools/transpiler-explorer',
            'developer-tools/quantum-debugger',
            'developer-tools/mcp-agent',
          ],
        },
        {
          label: 'Kernel API',
          items: [
            'kernel-api/overview',
            'kernel-api/messages-execution',
            'kernel-api/messages-hardware',
            'kernel-api/messages-qec',
            'kernel-api/schemas',
            'kernel-api/errors',
            'kernel-api/client-examples',
          ],
        },
        {
          label: 'Frameworks',
          items: [
            'frameworks/overview',
            'frameworks/qiskit',
            'frameworks/cirq',
            'frameworks/cudaq',
            'frameworks/qsharp',
          ],
        },
        {
          label: 'Hardware',
          items: ['hardware/overview', 'hardware/azure-quantum', 'hardware/pipelines'],
        },
        {
          label: 'Dirac AI',
          items: ['dirac/architecture', 'dirac/agent-runtime', 'dirac/extending'],
        },
        {
          label: 'Extending',
          items: [
            'extending/framework-adapters',
            'extending/hardware-providers',
            'extending/plugins',
            'extending/contributing',
          ],
        },
        {
          label: 'Reference',
          items: [
            'reference/configuration',
            'reference/framework-catalog',
            'reference/qec-data-schema',
            'reference/protocol-changelog',
          ],
        },
      ],
    }),
  ],
});
