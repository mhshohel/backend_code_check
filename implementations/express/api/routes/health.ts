import { checkLiveness, checkReadiness, type Services } from '@ofl/server-core';
import { Router } from 'express';

/** Liveness (process is up), readiness (dependencies reachable) and Prometheus metrics. */
export function healthRoutes(services: Services): Router {
  const router = Router();
  router.get('/health/live', (_req, res) => {
    res.json(checkLiveness());
  });
  router.get('/health/ready', async (_req, res) => {
    const readiness = await checkReadiness(services);
    res.status(readiness.ok ? 200 : 503).json(readiness);
  });
  router.get('/metrics', async (_req, res) => {
    res.type(services.metrics.contentType).send(await services.metrics.render());
  });
  return router;
}
