// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

// Nuclei developer docs — served at https://nuclei.dev/docs
// Built standalone (own package.json) and copied into dist-vercel/docs/
// by scripts/build-vercel.sh.
export default defineConfig({
  site: 'https://nuclei.dev',
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
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/calelamb/nuclei' },
      ],
      customCss: [
        // Self-hosted fonts (no render-blocking Google Fonts requests).
        '@fontsource/exo/400.css',
        '@fontsource/exo/600.css',
        '@fontsource/exo/700.css',
        '@fontsource/roboto-mono/400.css',
        '@fontsource/roboto-mono/500.css',
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
          label: 'Kernel API',
          items: [
            'kernel-api/overview',
            'kernel-api/messages-execution',
            'kernel-api/messages-hardware',
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
