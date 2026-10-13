/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Host-neutral build: relative base ('./') + hash routing means the SAME artifact works at
 * `/` and at any subpath (e.g. `/saga-hq/`) on any static host. VITE_BASE_PATH may override.
 */
function cspPlugin(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "style-src 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self' https://www.googleapis.com https://openidconnect.googleapis.com https://oauth2.googleapis.com https://accounts.google.com https://api.openai.com https://api.anthropic.com https://script.google.com https://script.googleusercontent.com",
    'frame-src https://accounts.google.com',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'saga-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const base = env.VITE_BASE_PATH || './';
  return {
    base,
    define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16)) },
    plugins: [
      react(),
      cspPlugin(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Saga HQ',
          short_name: 'Saga HQ',
          description: 'Creative operating system: ideas, production, publishing, learning.',
          start_url: './',
          scope: './',
          display: 'standalone',
          background_color: '#0c0a08',
          theme_color: '#0c0a08',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          shortcuts: [
            { name: 'Capture', url: './#/?capture=1' },
            { name: 'Today', url: './#/' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallback: 'index.html',
          // the home-screen quick capture page is its own document, never the app shell
          navigateFallbackDenylist: [/quick\.html/],
          cleanupOutdatedCaches: true,
          clientsClaim: false,
          skipWaiting: false,
          runtimeCaching: [],
        },
        devOptions: { enabled: false },
      }),
    ],
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 900 },
    worker: { format: 'es' },
    test: {
      environment: 'jsdom',
      setupFiles: ['tests/setup.ts'],
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
      testTimeout: 30000,
    },
  };
});
