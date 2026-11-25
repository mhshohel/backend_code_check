import { systemClock, type Clock } from './clock';
import type { AppConfig } from './config';
import { createDb, type Db } from './db/db';
import { createLogger, type Logger } from './observability/logger';
import { createMetrics, type Metrics } from './observability/metrics';
import { createRealtimeHub, type RealtimeHub } from './realtime/hub';
import { createSearchService, type SearchService } from './search/service';

export type ServiceRole = 'api' | 'worker' | 'cli';

/** Long-lived resources of one process. Created once at startup, closed at shutdown. */
export type Services = {
  config: AppConfig;
  db: Db;
  search: SearchService;
  realtime: RealtimeHub;
  logger: Logger;
  metrics: Metrics;
  clock: Clock;
};

export type CreateServicesOptions = { logger?: Logger; clock?: Clock; role?: ServiceRole };

export async function createServices(config: AppConfig, options: CreateServicesOptions = {}): Promise<Services> {
  const role = options.role ?? 'api';
  const logger = options.logger ?? createLogger({ level: config.logLevel, name: `ofl-${role}` });
  const db = createDb({
    connectionString: config.databaseUrl,
    // The CLI needs one or two connections; API and worker use the configured bound.
    max: role === 'cli' ? Math.min(config.dbPoolMax, 4) : config.dbPoolMax,
    statementTimeoutMs: config.statementTimeoutMs,
    applicationName: `ofl-${role}`,
  });
  return {
    config,
    db,
    search: createSearchService(config, logger),
    realtime: createRealtimeHub({ connectionString: config.databaseUrl, logger }),
    logger,
    metrics: createMetrics({ defaultMetrics: role !== 'cli' }),
    clock: options.clock ?? systemClock,
  };
}

export async function closeServices(services: Services): Promise<void> {
  await services.realtime.close();
  await services.search.close().catch(() => undefined);
  await services.db.close();
}
