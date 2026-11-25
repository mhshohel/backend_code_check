import express, { Router } from 'express';
import { join } from 'node:path';

const API_PREFIXES = ['/graphql', '/auth', '/webhooks', '/health', '/metrics'];

/** Production: serve the built SPA and fall back to index.html for client-side routes. */
export function spaRoutes(staticDir: string): Router {
  const router = Router();
  router.use(
    '/assets',
    express.static(join(staticDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }),
  );
  router.use(express.static(staticDir, { index: false, maxAge: 0 }));
  router.get(/.*/, (req, res, next) => {
    if (API_PREFIXES.some((prefix) => req.path.startsWith(prefix)) || !req.accepts('html')) return next();
    res.sendFile(join(staticDir, 'index.html'), { headers: { 'cache-control': 'no-cache' } });
  });
  return router;
}
