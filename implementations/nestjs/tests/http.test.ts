import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { signWebhookBody } from '@ofl/server-core';
import { resetToFixture } from '@ofl/test-fixtures';
import WebSocket from 'ws';
import { CSRF, JSON_CSRF, startTestServer, testConfig, WEB_ORIGIN, type TestServer } from './helpers';

const config = testConfig();
const CUSTOMER = { email: 'customer@example.com', password: 'customer-pass-1' };
let server: TestServer;

beforeAll(async () => {
  await resetToFixture(config, 'contract');
  server = await startTestServer(config);
}, 60_000);

afterAll(async () => {
  await server?.stop();
});

function post(path: string, body: unknown, headers: Record<string, string> = JSON_CSRF) {
  return fetch(server.url(path), { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

function sessionCookie(response: Response): string {
  const header = response.headers.getSetCookie().find((cookie) => cookie.startsWith('ofl_session='));
  if (!header) throw new Error('no session cookie');
  return header.split(';')[0] ?? '';
}

describe('health and observability', () => {
  it('answers liveness, readiness and metrics', async () => {
    const live = await fetch(server.url('/health/live'));
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ ok: true });

    const ready = await fetch(server.url('/health/ready'));
    const body = (await ready.json()) as { ok: boolean; checks: Record<string, { ok: boolean }> };
    expect(ready.status).toBe(body.ok ? 200 : 503);
    expect(body.checks.postgres?.ok).toBe(true);

    const metrics = await fetch(server.url('/metrics'));
    expect(metrics.status).toBe(200);
    expect(await metrics.text()).toContain('ofl_http_request_duration_seconds');
  });

  it('echoes a valid correlation id and generates one otherwise', async () => {
    const id = '0c6a5d1e-3f0b-4b8e-9d55-6f8f6f0d3a11';
    const echoed = await fetch(server.url('/health/live'), { headers: { 'x-correlation-id': id } });
    expect(echoed.headers.get('x-correlation-id')).toBe(id);
    const generated = await fetch(server.url('/health/live'), { headers: { 'x-correlation-id': 'not a valid id; <script>' } });
    expect(generated.headers.get('x-correlation-id')).toMatch(/^[\w-]{8,}$/);
  });

  it('sets security headers and hides the framework', async () => {
    const response = await fetch(server.url('/health/live'));
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });
});

describe('authentication', () => {
  it('sets an HttpOnly, SameSite=Lax session cookie on login and clears it on logout', async () => {
    const response = await post('/auth/login', CUSTOMER);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { email: CUSTOMER.email, role: 'CUSTOMER' } });
    const setCookie = response.headers.getSetCookie().find((c) => c.startsWith('ofl_session=')) ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=28800/);
    expect(setCookie).not.toMatch(/Secure/i); // Secure only in production

    const cookie = sessionCookie(response);
    const viewer = await post('/graphql', { query: '{ viewer { email } }' }, { ...JSON_CSRF, cookie });
    expect(await viewer.json()).toEqual({ data: { viewer: { email: CUSTOMER.email } } });

    const logout = await fetch(server.url('/auth/logout'), { method: 'POST', headers: { ...CSRF, cookie } });
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie().join(';')).toMatch(/ofl_session=;.*Expires=Thu, 01 Jan 1970/);

    const after = await post('/graphql', { query: '{ viewer { email } }' }, { ...JSON_CSRF, cookie });
    expect(await after.json()).toEqual({ data: { viewer: null } });
  });

  it('rejects bad input with 400 and wrong credentials with 401', async () => {
    const invalid = await post('/auth/login', { email: 'not-an-email', password: '' });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: expect.any(String), correlationId: expect.any(String) });
    const wrong = await post('/auth/login', { ...CUSTOMER, password: 'nope' });
    expect(wrong.status).toBe(401);
  });
});

describe('CSRF', () => {
  it('rejects state-changing requests without x-ofl-csrf', async () => {
    const login = await post('/auth/login', CUSTOMER, { 'content-type': 'application/json' });
    expect(login.status).toBe(403);
    expect(await login.json()).toMatchObject({ error: expect.stringContaining('x-ofl-csrf') });

    const graphql = await post('/graphql', { query: '{ viewer { id } }' }, { 'content-type': 'application/json' });
    expect(graphql.status).toBe(403);
    expect(await graphql.json()).toMatchObject({ errors: [{ extensions: { code: 'FORBIDDEN' } }] });
  });
});

describe('CORS', () => {
  it('allows the web origin with credentials and ignores other origins', async () => {
    const preflight = (origin: string) =>
      fetch(server.url('/graphql'), {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-ofl-csrf' },
      });
    const allowed = await preflight(WEB_ORIGIN);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true');
    expect(allowed.headers.get('access-control-allow-headers')).toContain('x-ofl-csrf');

    const denied = await preflight('https://evil.example');
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('limits and error format', () => {
  it('rejects bodies over 100 KB with 413', async () => {
    const big = JSON.stringify({ query: '{ viewer { id } }', variables: { padding: 'x'.repeat(110 * 1024) } });
    const response = await post('/graphql', big);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('too large') });
  });

  it('applies the 100 KB limit to every JSON media type on /graphql', async () => {
    const big = JSON.stringify({ query: '{ __typename }', variables: { padding: 'x'.repeat(110 * 1024) } });
    for (const type of ['application/graphql+json', 'application/graphql-response+json']) {
      const response = await post('/graphql', big, { ...CSRF, 'content-type': type });
      expect(response.status).toBe(413);
    }
    const small = await post('/graphql', { query: '{ __typename }' }, { ...CSRF, 'content-type': 'application/graphql+json' });
    expect(small.status).toBe(200);
    expect(await small.json()).toEqual({ data: { __typename: 'Query' } });
  });

  it('rejects non-JSON GraphQL bodies with 415 before Yoga reads them', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'application/graphql']) {
      const response = await post('/graphql', 'query=' + 'x'.repeat(200 * 1024), { ...CSRF, 'content-type': type });
      expect(response.status).toBe(415);
      expect(await response.json()).toMatchObject({ errors: [{ extensions: { code: 'BAD_USER_INPUT' } }] });
    }
  });

  it('answers malformed JSON with 400 and unknown routes with 404 in the same shape', async () => {
    const malformed = await post('/auth/login', '{"email":');
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: 'Request body is not valid JSON.', correlationId: expect.any(String) });
    const missing = await fetch(server.url('/nope'));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'Not found.' });
  });

  it('rate limits login attempts per IP', async () => {
    const limited = await startTestServer(config, { rateLimits: { loginPerMinute: 2, graphqlPerMinute: 1000, webhookPerMinute: 1000 } });
    try {
      const attempt = () =>
        fetch(limited.url('/auth/login'), { method: 'POST', headers: JSON_CSRF, body: JSON.stringify({ ...CUSTOMER, password: 'x' }) });
      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);
      const third = await attempt();
      expect(third.status).toBe(429);
      expect(await third.json()).toMatchObject({ error: expect.any(String) });
      expect(third.headers.get('ratelimit-policy')).toContain('2');
    } finally {
      await limited.stop();
    }
  });

  it('returns RATE_LIMITED as a GraphQL error on /graphql', async () => {
    const limited = await startTestServer(config, { rateLimits: { loginPerMinute: 10, graphqlPerMinute: 1, webhookPerMinute: 10 } });
    try {
      const query = () => fetch(limited.url('/graphql'), { method: 'POST', headers: JSON_CSRF, body: JSON.stringify({ query: '{ viewer { id } }' }) });
      expect((await query()).status).toBe(200);
      const second = await query();
      expect(second.status).toBe(429);
      expect(await second.json()).toMatchObject({ errors: [{ extensions: { code: 'RATE_LIMITED' } }] });
    } finally {
      await limited.stop();
    }
  });
});

describe('payment webhook', () => {
  it('verifies the signature over the raw body', async () => {
    const body = JSON.stringify({ providerEventId: 'evt-x', paymentId: '00000000-0000-4000-8000-000000000000', kind: 'PAYMENT_SUCCEEDED', amountMinor: 100 });
    const unsigned = await post('/webhooks/payments', body, { 'content-type': 'application/json', 'x-ofl-signature': 'sha256=00' });
    expect(unsigned.status).toBe(401);

    const malformed = '{"providerEventId":';
    const badBody = await post('/webhooks/payments', malformed, {
      'content-type': 'application/json',
      'x-ofl-signature': signWebhookBody(malformed, config.paymentWebhookSecret),
    });
    expect(badBody.status).toBe(400);
  });
});

describe('GraphQL WebSocket upgrade', () => {
  function connect(headers: Record<string, string>): Promise<'open' | number> {
    const url = server.wsUrl;
    return new Promise((resolve) => {
      const socket = new WebSocket(url, 'graphql-transport-ws', { headers });
      socket.once('open', () => {
        socket.close();
        resolve('open');
      });
      socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
      socket.once('error', () => undefined);
    });
  }

  it('accepts the web origin and clients without Origin, rejects other origins', async () => {
    expect(await connect({ origin: WEB_ORIGIN })).toBe('open');
    expect(await connect({})).toBe('open');
    expect(await connect({ origin: 'https://evil.example' })).toBe(403);
  });
});

describe('metrics labels', () => {
  it('labels mounted routes by their full path', async () => {
    await post('/graphql', { query: '{ viewer { id } }' });
    const text = await (await fetch(server.url('/metrics'))).text();
    expect(text).toMatch(/ofl_http_request_duration_seconds_count\{[^}]*route="\/graphql"/);
  });
});

describe('NestJS lifecycle', () => {
  it('app.close() closes WebSockets with 1001, then the HTTP server, then the services', async () => {
    const instance = await startTestServer(config);
    const socket = new WebSocket(instance.wsUrl, 'graphql-transport-ws');
    await new Promise((resolve) => socket.once('open', resolve));
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));

    await instance.stop();

    expect(await closed).toBe(1001);
    await expect(fetch(instance.url('/health/live'))).rejects.toThrow();
    await expect(instance.services.db.query('SELECT 1')).rejects.toThrow();
  });
});

describe('NestJS request pipeline', () => {
  it('does not run the CSRF guard or the session middleware on the webhook', async () => {
    // No x-ofl-csrf header and no cookie: the answer comes from the signature check.
    const response = await post('/webhooks/payments', '{}', { 'content-type': 'application/json', 'x-ofl-signature': 'sha256=00' });
    expect(response.status).toBe(401);
  });

  it('answers 404 for unknown API paths through the exception filter, with a correlation id', async () => {
    const response = await fetch(server.url('/graphql/unknown'), { headers: { accept: 'text/html' } });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string; correlationId: string };
    expect(body.correlationId).toBe(response.headers.get('x-correlation-id'));
  });
});
