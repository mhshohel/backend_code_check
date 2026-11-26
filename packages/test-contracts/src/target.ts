import type { AppConfig } from '@ofl/server-core';

export type VariantName = 'express' | 'fastify' | 'nextjs' | 'nestjs';

export type TargetHttp = {
  baseUrl: string;
  graphqlPath: string;
  loginPath: string;
  logoutPath: string;
  webhookPath: string;
  wsUrl: string;
};

export type RunningInstance = { baseUrl: string; stop(): Promise<void> };
export type RunningRealtimeInstance = RunningInstance & { wsUrl: string };

/**
 * One variant under test. Requirements on the running target:
 * - it uses `config` (test database, test index prefix, webhook secret) and
 *   runs with ENABLE_QUERY_COUNT=true;
 * - no worker process runs: the suite drives the shared worker engine itself
 *   so that each scenario processes only its own jobs;
 * - rate limits allow a full suite run from 127.0.0.1 (several hundred
 *   GraphQL requests per minute);
 * - WebSocket upgrades without an Origin header (non-browser clients) are accepted.
 */
export type AcceptanceTarget = {
  name: VariantName;
  config: AppConfig;
  http: TargetHttp;
  /** S14: a second API instance (own process or own server object) on the same database. */
  startSecondInstance(): Promise<RunningRealtimeInstance>;
  /** S13: an API instance whose ELASTICSEARCH_URL refuses connections. */
  startWithSearchDown(): Promise<RunningInstance>;
};
