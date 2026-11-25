import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4100';

// Dev: the SPA is served on 4101 and every API path is proxied to the Express
// API on 4100, so the browser sees one origin (cookies, CSRF header, CORS).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 4101,
    strictPort: true,
    proxy: {
      '/graphql': { target: API_ORIGIN, ws: true, changeOrigin: false },
      '/auth': { target: API_ORIGIN, changeOrigin: false },
      '/webhooks': { target: API_ORIGIN, changeOrigin: false },
      '/health': { target: API_ORIGIN, changeOrigin: false },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
});
