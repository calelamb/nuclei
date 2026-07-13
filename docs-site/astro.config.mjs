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
      title: 'NUCLEI Docs',
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
        // Default the docs to the light blue-white theme on first visit to
        // match the v0.5.0 redesign (marketing site is light-only). Keeps the
        // full auto/light/dark picker; user choice still persists.
        ThemeProvider: './src/components/ThemeProvider.astro',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/calelamb/nuclei' },
      ],
      customCss: [
        // Self-hosted fonts (no render-blocking Google Fonts requests).
        // Blue-brand redesign (v0.5.0): Space Grotesk display, IBM Plex Sans
        // body, JetBrains Mono code.
        '@fontsource/space-grotesk/400.css',
        '@fontsource/space-grotesk/500.css',
        '@fontsource/space-grotesk/600.css',
        '@fontsource/space-grotesk/700.css',
        '@fontsource/ibm-plex-sans/300.css',
        '@fontsource/ibm-plex-sans/400.css',
        '@fontsource/ibm-plex-sans/500.css',
        '@fontsource/ibm-plex-sans/600.css',
        '@fontsource/ibm-plex-sans/700.css',
        '@fontsource/jetbrains-mono/400.css',
        '@fontsource/jetbrains-mono/500.css',
        '@fontsource/jetbrains-mono/600.css',
        '@fontsource/jetbrains-mono/700.css',
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
          ],
        },
        {
          label: 'Research',
          items: [
            'research/workspace-modes',
            'research/experiments',
            'research/qec-studio',
            'research/campaigns',
            'research/noise-models',
            'research/resource-estimation',
            'research/reproducibility',
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
          items: ['dirac/architecture', 'dirac/extending'],
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
            'reference/protocol-changelog',
          ],
        },
      ],
    }),
  ],
});
