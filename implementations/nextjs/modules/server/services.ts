import 'server-only';
import { closeServices, createServices, loadConfig, type Services } from '@ofl/server-core';

// One Services instance (PostgreSQL pool, Elasticsearch client, logger,
// metrics, LISTEN connection) per Next.js server process. It lives on
// globalThis because `next dev` re-evaluates modules on every edit, and a
// module-level variable would leak a new pool per reload.
const SERVICES_KEY = Symbol.for('ofl.nextjs.services');

type ServicesHolder = { [SERVICES_KEY]?: Promise<Services> };

const holder = globalThis as typeof globalThis & ServicesHolder;

export function getServices(): Promise<Services> {
  const existing = holder[SERVICES_KEY];
  if (existing) return existing;

  const created = createServices(loadConfig(process.env), { role: 'api' }).catch((error: unknown) => {
    // A failed start (database down) must not poison every later request.
    delete holder[SERVICES_KEY];
    throw error;
  });
  holder[SERVICES_KEY] = created;
  return created;
}

/** Used by tests and graceful shutdown hooks. */
export async function disposeServices(): Promise<void> {
  const existing = holder[SERVICES_KEY];
  delete holder[SERVICES_KEY];
  if (existing) await closeServices(await existing);
}
