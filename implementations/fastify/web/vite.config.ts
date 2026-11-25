import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: Vite serves the SPA on 4201 and proxies API paths to Fastify on 4200,
// so the browser sees one origin (SameSite cookie, CSRF header, WebSocket).
const API_TARGET = process.env.API_ORIGIN ?? 'http://127.0.0.1:4200';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    port: 4201,
    strictPort: true,
    proxy: {
      '/graphql': { target: API_TARGET, ws: true, changeOrigin: false },
      '/auth': { target: API_TARGET },
      '/webhooks': { target: API_TARGET },
      '/health': { target: API_TARGET },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
