// Local-only workbench config. The normal build/deployment config is unchanged.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import base from './astro.config.mjs';

export default {
  ...base,
  devToolbar: { enabled: false },
  vite: {
    ...base.vite,
    cacheDir: '.astro/draftx-vite',
    server: {
      fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), realpathSync(fileURLToPath(new URL('./node_modules', import.meta.url)))] },
    },
  },
};
