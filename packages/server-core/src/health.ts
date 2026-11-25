import type { Services } from './services';

export type DependencyCheck = { ok: boolean; latencyMs: number; error?: string };
export type Readiness = { ok: boolean; checks: Record<'postgres' | 'elasticsearch', DependencyCheck> };

export function checkLiveness(): { ok: true } {
  return { ok: true };
}

/**
 * Readiness reports both dependencies, but only PostgreSQL decides `ok`:
 * the shop keeps working without Elasticsearch (search degrades to
 * SEARCH_UNAVAILABLE), so a search outage must not take the API out of rotation.
 */
export async function checkReadiness(services: Services): Promise<Readiness> {
  const [postgres, elasticsearch] = await Promise.all([
    timed(services, 'postgres', async () => {
      await services.db.query('SELECT 1');
    }),
    timed(services, 'elasticsearch', async () => {
      if (!(await services.search.ping())) throw new Error('Elasticsearch did not answer.');
    }),
  ]);
  return { ok: postgres.ok, checks: { postgres, elasticsearch } };
}

// The response may be public, so it carries a fixed code; hosts, ports,
// and driver messages go to the log only.
async function timed(services: Services, dependency: string, check: () => Promise<void>): Promise<DependencyCheck> {
  const started = performance.now();
  try {
    await check();
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    services.logger.warn({ err: error, dependency }, 'readiness check failed');
    return { ok: false, latencyMs: Math.round(performance.now() - started), error: 'unreachable' };
  }
}
