import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:9011';

// Dev: the SPA is served on 9012 and every API path is proxied to the NestJS
// API on 9011, so the browser sees one origin (cookies, CSRF header, CORS).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 9012,
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
