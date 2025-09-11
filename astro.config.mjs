import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://sonnycourt.com',
  integrations: [],
  vite: {
    ssr: {
      external: ['svgo'],
    },
  },
});