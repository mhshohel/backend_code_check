import { afterAll, beforeAll } from '@jest/globals';
import { loadConfig } from '@ofl/server-core';
import {
  defineAcceptanceSuite,
  UNREACHABLE_ELASTICSEARCH_URL,
  type AcceptanceTarget,
  type RunningRealtimeInstance,
} from '@ofl/test-contracts';
import { startNext, type RunningNext } from '../support/next-process';
import { startRealtime } from '../support/realtime-instance';
import { testEnv } from '../support/test-env';
import type { RunningRealtimeServer } from '@/modules/realtime/server';

// The shared acceptance suite against the production build (`next start`)
// plus the realtime service. No worker runs: the suite drives jobs itself.

const env = testEnv();
const stops: Array<() => Promise<void>> = [];
let target: AcceptanceTarget;

async function startPair(pairEnv: Record<string, string>): Promise<{ app: RunningNext; realtime: RunningRealtimeServer }> {
  const app = await startNext(pairEnv);
  const realtime = await startRealtime(pairEnv, app.baseUrl);
  stops.push(() => realtime.close(), () => app.stop());
  return { app, realtime };
}

beforeAll(async () => {
  const primary = await startPair(env);
  target = {
    name: 'nextjs',
    config: loadConfig(env),
    http: {
      baseUrl: primary.app.baseUrl,
      graphqlPath: '/api/graphql',
      loginPath: '/api/auth/login',
      logoutPath: '/api/auth/logout',
      webhookPath: '/api/webhooks/payments',
      wsUrl: primary.realtime.url,
    },
    async startSecondInstance(): Promise<RunningRealtimeInstance> {
      const second = await startPair(env);
      return {
        baseUrl: second.app.baseUrl,
        wsUrl: second.realtime.url,
        stop: async () => {
          await second.realtime.close();
          await second.app.stop();
        },
      };
    },
    async startWithSearchDown() {
      const app = await startNext(testEnv({ ELASTICSEARCH_URL: UNREACHABLE_ELASTICSEARCH_URL }));
      stops.push(() => app.stop());
      return { baseUrl: app.baseUrl, stop: () => app.stop() };
    },
  };
}, 120_000);

afterAll(async () => {
  for (const stop of stops.reverse()) await stop().catch(() => undefined);
});

defineAcceptanceSuite(() => target);
