import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { signatureHeader } from '@ofl/test-contracts';
import { resetToFixture } from '@ofl/test-fixtures';
import type { InjectOptions } from 'fastify';
import WebSocket from 'ws';
import { startServer, TEST_WEB_ORIGIN, TEST_WEBHOOK_SECRET, testConfig, type RunningServer } from './support/test-server';

const config = testConfig();
const CUSTOMER = { email: 'customer@example.com', password: 'customer-pass-1' };
const CSRF = { 'x-ofl-csrf': '1' };
const JSON_HEADERS = { 'content-type': 'application/json' };

let api: RunningServer;

beforeAll(async () => {
  await resetToFixture(config, 'contract');
  api = await startServer(config);
});

afterAll(async () => {
  await api?.stop();
});

const inject = (options: InjectOptions) => api.server.inject(options);

async function loginCookie(): Promise<string> {
  const response = await inject({ method: 'POST', url: '/auth/login', headers: { ...JSON_HEADERS, ...CSRF }, payload: CUSTOMER });
  const cookie = response.cookies.find((item) => item.name === 'ofl_session');
  if (!cookie) throw new Error(`login failed: ${response.statusCode} ${response.body}`);
  return `ofl_session=${cookie.value}`;
}

describe('auth routes', () => {
  it('sets an HttpOnly, SameSite=Lax session cookie and returns the user', async () => {
    const response = await inject({ method: 'POST', url: '/auth/login', headers: { ...JSON_HEADERS, ...CSRF }, payload: CUSTOMER });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user: expect.objectContaining({ email: CUSTOMER.email, role: 'CUSTOMER' }) });
    const cookie = response.cookies.find((item) => item.name === 'ofl_session');
    expect(cookie).toEqual(expect.objectContaining({ httpOnly: true, sameSite: 'Lax', path: '/' }));
    expect(cookie?.secure).toBeFalsy();
    expect(cookie?.maxAge).toBe(config.sessionTtlSeconds);
  });

  it('rejects bad credentials with 401 and a bad body with 400', async () => {
    const wrong = await inject({ method: 'POST', url: '/auth/login', headers: { ...JSON_HEADERS, ...CSRF }, payload: { ...CUSTOMER, password: 'nope' } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: expect.any(String) });
    const malformed = await inject({ method: 'POST', url: '/auth/login', headers: { ...JSON_HEADERS, ...CSRF }, payload: { email: 1 } });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual(expect.objectContaining({ error: expect.any(String), code: 'BAD_REQUEST' }));
  });

  it('logout returns 204, expires the cookie, and revokes the session', async () => {
    const cookie = await loginCookie();
    const response = await inject({ method: 'POST', url: '/auth/logout', headers: { ...CSRF, cookie } });
    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toEqual(expect.stringContaining('ofl_session=;'));
    const viewer = await inject({
      method: 'POST',
      url: '/graphql',
      headers: { ...JSON_HEADERS, ...CSRF, cookie },
      payload: { query: '{ viewer { id } }' },
    });
    expect(viewer.json()).toEqual({ data: { viewer: null } });
  });

  it('rate limits login attempts per IP with 429', async () => {
    const limited = await startServer(config, { rateLimits: { loginPerMinute: 2, graphqlPerMinute: 1000, webhookPerMinute: 1000 } });
    try {
      const attempt = () =>
        limited.server.inject({ method: 'POST', url: '/auth/login', headers: { ...JSON_HEADERS, ...CSRF }, payload: { ...CUSTOMER, password: 'x' } });
      expect((await attempt()).statusCode).toBe(401);
      expect((await attempt()).statusCode).toBe(401);
      const blocked = await attempt();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual(expect.objectContaining({ code: 'RATE_LIMITED', error: expect.any(String) }));
    } finally {
      await limited.stop();
    }
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without x-ofl-csrf with 403', async () => {
    const login = await inject({ method: 'POST', url: '/auth/login', headers: JSON_HEADERS, payload: CUSTOMER });
    expect(login.statusCode).toBe(403);
    const graphql = await inject({ method: 'POST', url: '/graphql', headers: JSON_HEADERS, payload: { query: '{ viewer { id } }' } });
    expect(graphql.statusCode).toBe(403);
    expect(graphql.json()).toEqual(expect.objectContaining({ code: 'CSRF_HEADER_MISSING' }));
  });
});

describe('CORS', () => {
  it('allows the variant web origin with credentials', async () => {
    const response = await inject({
      method: 'OPTIONS',
      url: '/graphql',
      headers: { origin: TEST_WEB_ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-ofl-csrf' },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not allow other origins', async () => {
    const response = await inject({
      method: 'OPTIONS',
      url: '/graphql',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('request limits and errors', () => {
  it('rejects bodies over 100 KB with 413 in the common error format', async () => {
    const response = await inject({
      method: 'POST',
      url: '/graphql',
      headers: { ...JSON_HEADERS, ...CSRF },
      payload: JSON.stringify({ query: `{ viewer { id } } #${'x'.repeat(110 * 1024)}` }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: expect.any(String), code: 'PAYLOAD_TOO_LARGE', correlationId: expect.any(String) });
  });

  it('returns JSON 404 with the correlation id for unknown API routes', async () => {
    const response = await inject({ method: 'GET', url: '/auth/nope', headers: { 'x-correlation-id': 'test-correlation-0001' } });
    expect(response.statusCode).toBe(404);
    expect(response.headers['x-correlation-id']).toBe('test-correlation-0001');
    expect(response.json()).toEqual({ error: expect.any(String), code: 'NOT_FOUND', correlationId: 'test-correlation-0001' });
  });

  it('replaces an unsafe correlation id with a generated one', async () => {
    const response = await inject({ method: 'GET', url: '/health/live', headers: { 'x-correlation-id': 'bad id with spaces' } });
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets security headers (helmet)', async () => {
    const response = await inject({ method: 'GET', url: '/health/live' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toEqual(expect.stringContaining("default-src 'self'"));
  });
});

describe('payment webhook', () => {
  const body = JSON.stringify({ providerEventId: 'evt_http_test', paymentId: '00000000-0000-4000-8000-000000000000', kind: 'PAYMENT_SUCCEEDED', amountMinor: 100 });

  it('rejects a bad signature with 401', async () => {
    const response = await inject({
      method: 'POST',
      url: '/webhooks/payments',
      headers: { ...JSON_HEADERS, 'x-ofl-signature': `sha256=${'0'.repeat(64)}` },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
  });

  // Regression: the signature is checked before the body is parsed or
  // validated, so unsigned callers learn nothing about the body format.
  it('answers 401, not 400, for an unsigned or badly signed malformed body', async () => {
    for (const payload of ['{nope', JSON.stringify({ providerEventId: 'x' })]) {
      const unsigned = await inject({ method: 'POST', url: '/webhooks/payments', headers: JSON_HEADERS, payload });
      expect(unsigned.statusCode).toBe(401);
      expect(JSON.stringify(unsigned.json())).not.toMatch(/providerEventId|required|must have/i);
      const forged = await inject({
        method: 'POST',
        url: '/webhooks/payments',
        headers: { ...JSON_HEADERS, 'x-ofl-signature': `sha256=${'0'.repeat(64)}` },
        payload,
      });
      expect(forged.statusCode).toBe(401);
    }
  });

  it('rejects malformed JSON and invalid shapes with 400 once the signature is valid', async () => {
    const signed = (raw: string) => ({ ...JSON_HEADERS, 'x-ofl-signature': signatureHeader(raw, TEST_WEBHOOK_SECRET) });
    const malformed = await inject({ method: 'POST', url: '/webhooks/payments', headers: signed('{nope'), payload: '{nope' });
    expect(malformed.statusCode).toBe(400);
    const shape = JSON.stringify({ providerEventId: 'x' });
    const invalid = await inject({ method: 'POST', url: '/webhooks/payments', headers: signed(shape), payload: shape });
    expect(invalid.statusCode).toBe(400);
  });

  it('does not require the CSRF header (server-to-server call)', async () => {
    const response = await inject({
      method: 'POST',
      url: '/webhooks/payments',
      headers: { ...JSON_HEADERS, 'x-ofl-signature': signatureHeader(body, TEST_WEBHOOK_SECRET) },
      payload: body,
    });
    expect(response.statusCode).not.toBe(403);
  });
});

describe('health and metrics', () => {
  it('reports liveness and readiness of PostgreSQL and Elasticsearch', async () => {
    expect((await inject({ method: 'GET', url: '/health/live' })).json()).toEqual({ ok: true });
    const ready = await inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual(expect.objectContaining({ ok: true, checks: expect.objectContaining({ postgres: expect.objectContaining({ ok: true }) }) }));
  });

  // Search is derived data: an Elasticsearch outage degrades search only, so
  // readiness reports it but stays 200 (server-core checkReadiness).
  it('stays ready but reports Elasticsearch as failing when it is unreachable', async () => {
    const degraded = await startServer(testConfig({ ELASTICSEARCH_URL: 'http://127.0.0.1:9' }));
    try {
      const ready = await degraded.server.inject({ method: 'GET', url: '/health/ready' });
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toEqual(
        expect.objectContaining({ ok: true, checks: expect.objectContaining({ elasticsearch: expect.objectContaining({ ok: false }) }) }),
      );
    } finally {
      await degraded.stop();
    }
  });

  it('exposes Prometheus metrics including HTTP latency by route', async () => {
    await inject({ method: 'GET', url: '/health/live' });
    const response = await inject({ method: 'GET', url: '/metrics' });
    expect(response.headers['content-type']).toEqual(expect.stringContaining('text/plain'));
    expect(response.body).toContain('ofl_http_request_duration_seconds_count{method="GET",route="/health/live"');
  });
});

describe('GraphQL over WebSocket', () => {
  const openSocket = (headers: Record<string, string>) =>
    new Promise<number | 'open'>((resolve) => {
      const socket = new WebSocket(api.wsUrl, 'graphql-transport-ws', { headers });
      socket.on('open', () => {
        socket.close();
        resolve('open');
      });
      socket.on('unexpected-response', (_request, response) => {
        resolve(response.statusCode ?? 0);
        socket.terminate();
      });
      socket.on('error', () => undefined);
    });

  it('accepts upgrades from the allowed origin and from non-browser clients', async () => {
    expect(await openSocket({ origin: TEST_WEB_ORIGIN })).toBe('open');
    expect(await openSocket({})).toBe('open');
  });

  it('rejects upgrades from other origins with 403', async () => {
    expect(await openSocket({ origin: 'https://evil.example' })).toBe(403);
  });
});
