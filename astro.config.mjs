import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://sonnycourt.com',
  integrations: [tailwind({ applyBaseStyles: true }), {
    name: 'marketing-custom-destinations',
    hooks: {
      'astro:config:setup'({ injectScript }) {
        injectScript('page', `if (new URLSearchParams(location.search).get('sc_custom') === '1') {
          import('/src/lib/marketing-attribution.mjs').then(({ initMarketingAttribution }) => initMarketingAttribution());
        }`);
      },
    },
  }],
  vite: {
    ssr: {
      external: ['svgo'],
    },
  },
});