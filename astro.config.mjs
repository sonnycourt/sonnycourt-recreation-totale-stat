import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://sonnycourt.com',
  integrations: [tailwind({ applyBaseStyles: true })],
  vite: {
    ssr: {
      external: ['svgo'],
    },
  },
});