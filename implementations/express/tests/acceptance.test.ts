import { afterAll, beforeAll } from '@jest/globals';
import { defineAcceptanceSuite, UNREACHABLE_ELASTICSEARCH_URL, type AcceptanceTarget } from '@ofl/test-contracts';
import { startTestServer, testConfig, type TestServer } from './helpers';

// The shared 14 scenarios against the Express variant (ofl_express_test).
// No worker runs here: the suite drives the worker engine itself.
const config = testConfig();
const servers: TestServer[] = [];
let target: AcceptanceTarget;

async function start(overrides: Record<string, string> = {}): Promise<TestServer> {
  const server = await startTestServer(Object.keys(overrides).length > 0 ? testConfig(overrides) : config);
  servers.push(server);
  return server;
}

function wsUrl(server: TestServer): string {
  return `${server.running.baseUrl.replace(/^http/, 'ws')}/graphql`;
}

beforeAll(async () => {
  const primary = await start();
  target = {
    name: 'express',
    config,
    http: {
      baseUrl: primary.running.baseUrl,
      graphqlPath: '/graphql',
      loginPath: '/auth/login',
      logoutPath: '/auth/logout',
      webhookPath: '/webhooks/payments',
      wsUrl: wsUrl(primary),
    },
    async startSecondInstance() {
      const second = await start();
      return { baseUrl: second.running.baseUrl, wsUrl: wsUrl(second), stop: () => second.stop() };
    },
    async startWithSearchDown() {
      const degraded = await start({ ELASTICSEARCH_URL: UNREACHABLE_ELASTICSEARCH_URL });
      return { baseUrl: degraded.running.baseUrl, stop: () => degraded.stop() };
    },
  };
}, 60_000);

afterAll(async () => {
  // stop() is idempotent, so instances a scenario already stopped are fine.
  await Promise.all(servers.map((server) => server.stop()));
});

defineAcceptanceSuite(() => target);
