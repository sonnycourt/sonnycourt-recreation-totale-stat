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
      // Local personal links use the existing MC2 endpoints, not a new backend.
      // Explicit ?preview=dev stays isolated by DraftXSandbox.
      proxy: {
        '^/\\.netlify/functions/(get-mc2-registration|mc2-video-config|request-mc2-access|check-mc2-eligibility|mc2-presence|track-mc2-event|mc2-spiffy-status|mc2-billing-info|mc2-replay-enter|mc2-replay-access|mc2-replay-track)(?:\\?|$)': {
          target: 'https://sonnycourt.com', changeOrigin: true,
        },
      },
      fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), realpathSync(fileURLToPath(new URL('./node_modules', import.meta.url)))] },
    },
  },
};
