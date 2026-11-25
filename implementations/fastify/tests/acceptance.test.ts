import { afterAll, beforeAll } from '@jest/globals';
import { defineAcceptanceSuite, UNREACHABLE_ELASTICSEARCH_URL, type AcceptanceTarget } from '@ofl/test-contracts';
import { startServer, testConfig, type RunningServer } from './support/test-server';

const config = testConfig();
let primary: RunningServer;
let target: AcceptanceTarget;

beforeAll(async () => {
  primary = await startServer(config);
  target = {
    name: 'fastify',
    config,
    http: {
      baseUrl: primary.baseUrl,
      graphqlPath: '/graphql',
      loginPath: '/auth/login',
      logoutPath: '/auth/logout',
      webhookPath: '/webhooks/payments',
      wsUrl: primary.wsUrl,
    },
    // A second Fastify instance with its own Services (pool + LISTEN connection) on the same database.
    startSecondInstance: () => startServer(config),
    startWithSearchDown: () => startServer(testConfig({ ELASTICSEARCH_URL: UNREACHABLE_ELASTICSEARCH_URL })),
  };
});

afterAll(async () => {
  await primary?.stop();
});

defineAcceptanceSuite(() => target);
