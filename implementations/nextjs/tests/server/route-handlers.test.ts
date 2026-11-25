import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { loadConfig, signWebhookBody } from '@ofl/server-core';
import { resetToFixture } from '@ofl/test-fixtures';
import { testEnv } from '../support/test-env';

// Route handlers are plain functions of a Web Request, so these tests call the
// exported handlers directly, in-process, against ofl_nextjs_test.
// Rate limiting stays ON here (RATE_LIMIT_DISABLED is not set) to test 429.
// TRUST_PROXY is off by default, as in a plain `next start`.
const env = testEnv({ RATE_LIMIT_DISABLED: 'false' });
Object.assign(process.env, env);
delete process.env.TRUST_PROXY;

type Handler = (request: Request) => Promise<Response>;
let graphql: { POST: Handler; OPTIONS: () => Response };
let loginRoute: { POST: Handler };
let logoutRoute: { POST: Handler };
let webhook: { POST: Handler };
let live: { GET: () => Response };
let ready: { GET: () => Promise<Response> };
let metrics: { GET: () => Promise<Response> };
let disposeServices: () => Promise<void>;
let resetLimiter: () => void;

const BASE = 'http://127.0.0.1:4300';
let ipCounter = 0;
const freshIp = () => `10.1.0.${++ipCounter}`;

function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp(), ...headers },
  });
}

const csrf = { 'x-ofl-csrf': '1' };

async function signIn(email = 'customer@example.com', password = 'customer-pass-1'): Promise<string> {
  const response = await loginRoute.POST(post('/api/auth/login', JSON.stringify({ email, password }), csrf));
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}

beforeAll(async () => {
  await resetToFixture(loadConfig(env), 'contract');
  graphql = await import('@/app/api/graphql/route');
  loginRoute = await import('@/app/api/auth/login/route');
  logoutRoute = await import('@/app/api/auth/logout/route');
  webhook = await import('@/app/api/webhooks/payments/route');
  live = await import('@/app/api/health/live/route');
  ready = await import('@/app/api/health/ready/route');
  metrics = await import('@/app/api/metrics/route');
  ({ disposeServices } = await import('@/modules/server/services'));
  const { processRateLimiter } = await import('@/modules/server/http/rate-limit');
  resetLimiter = () => processRateLimiter().reset();
}, 120_000);

// Without a trusted proxy every client shares one bucket per route, so each test starts with fresh counters.
beforeEach(() => {
  resetLimiter();
  delete process.env.TRUST_PROXY;
});

afterAll(async () => {
  await disposeServices();
});

describe('POST /api/auth/login', () => {
  it('rejects a missing CSRF header with 403', async () => {
    const response = await loginRoute.POST(post('/api/auth/login', '{}'));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it('returns 400 for a malformed body and 401 for wrong credentials', async () => {
    expect((await loginRoute.POST(post('/api/auth/login', 'not json', csrf))).status).toBe(400);
    const wrong = await loginRoute.POST(post('/api/auth/login', JSON.stringify({ email: 'customer@example.com', password: 'nope' }), csrf));
    expect(wrong.status).toBe(401);
  });

  it('signs in with an HttpOnly, SameSite=Lax session cookie', async () => {
    const response = await loginRoute.POST(
      post('/api/auth/login', JSON.stringify({ email: 'customer@example.com', password: 'customer-pass-1' }), csrf),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: expect.any(String), email: 'customer@example.com', displayName: expect.any(String), role: 'CUSTOMER' },
    });
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^ofl_session=[^;]+;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

});

describe('rate limits cannot be bypassed with X-Forwarded-For', () => {
  const wrongLogin = (forwardedFor: string, email = 'x@example.com') =>
    loginRoute.POST(post('/api/auth/login', JSON.stringify({ email, password: 'wrong-password' }), { ...csrf, 'x-forwarded-for': forwardedFor }));

  it('ignores a rotating client-supplied X-Forwarded-For when no proxy is trusted', async () => {
    for (let i = 0; i < 10; i += 1) expect((await wrongLogin(`203.0.113.${i}`, `user${i}@example.com`)).status).toBe(401);
    const limited = await wrongLogin('203.0.113.200', 'someone-else@example.com');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });

  it('keys on the right-most entry when TRUST_PROXY=true, so spoofed left entries do not help', async () => {
    process.env.TRUST_PROXY = 'true';
    for (let i = 0; i < 10; i += 1) expect((await wrongLogin(`198.51.100.${i}, 10.0.0.1`, `user${i}@example.com`)).status).toBe(401);
    expect((await wrongLogin('198.51.100.99, 10.0.0.1', 'other@example.com')).status).toBe(429);
    // A different client (as reported by the proxy) has its own bucket.
    expect((await wrongLogin('10.0.0.2', 'other@example.com')).status).toBe(401);
  });

  it('limits password guessing per account even when every attempt comes from a new trusted IP', async () => {
    process.env.TRUST_PROXY = 'true';
    for (let i = 0; i < 10; i += 1) expect((await wrongLogin(`10.1.${i}.1`, 'customer@example.com')).status).toBe(401);
    expect((await wrongLogin('10.1.99.1', 'Customer@Example.com')).status).toBe(429);
  });

  it('applies the same keying to the webhook limit', async () => {
    const body = '{}';
    for (let i = 0; i < 120; i += 1) {
      const response = await webhook.POST(post('/api/webhooks/payments', body, { 'x-forwarded-for': `192.0.2.${i % 250}`, 'x-ofl-signature': 'sha256=00' }));
      expect(response.status).not.toBe(429);
    }
    const limited = await webhook.POST(post('/api/webhooks/payments', body, { 'x-forwarded-for': '192.0.2.251', 'x-ofl-signature': 'sha256=00' }));
    expect(limited.status).toBe(429);
  });
});

describe('POST /api/graphql', () => {
  const viewerQuery = JSON.stringify({ query: '{ viewer { email role } }' });

  it('requires the CSRF header and same origin', async () => {
    expect((await graphql.POST(post('/api/graphql', viewerQuery))).status).toBe(403);
    expect((await graphql.POST(post('/api/graphql', viewerQuery, { ...csrf, origin: 'https://evil.example' }))).status).toBe(403);
    expect(graphql.OPTIONS().status).toBe(403);
  });

  it('resolves the viewer from the session cookie and marks the response private', async () => {
    const cookie = await signIn();
    const response = await graphql.POST(post('/api/graphql', viewerQuery, { ...csrf, cookie, origin: BASE }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { viewer: { email: 'customer@example.com', role: 'CUSTOMER' } } });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-correlation-id')).toBeTruthy();
  });

  it('enforces role checks in the application layer', async () => {
    const cookie = await signIn();
    const response = await graphql.POST(post('/api/graphql', JSON.stringify({ query: '{ operationsSummary { pendingJobs } }' }), { ...csrf, cookie }));
    const body = (await response.json()) as { errors?: Array<{ extensions?: { code?: string } }> };
    expect(body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  it('reports queryCount when asked and enabled', async () => {
    const response = await graphql.POST(
      post('/api/graphql', JSON.stringify({ query: '{ categories { id } }' }), { ...csrf, 'x-ofl-debug-query-count': '1' }),
    );
    const body = (await response.json()) as { extensions?: { queryCount?: number } };
    expect(typeof body.extensions?.queryCount).toBe('number');
  });

  it('rejects bodies over 100 KB', async () => {
    const huge = JSON.stringify({ query: `{ viewer { id } } # ${'x'.repeat(110 * 1024)}` });
    expect((await graphql.POST(post('/api/graphql', huge, csrf))).status).toBe(413);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session and expires the cookie', async () => {
    const cookie = await signIn();
    const response = await logoutRoute.POST(post('/api/auth/logout', '', { ...csrf, cookie }));
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');

    const after = await graphql.POST(post('/api/graphql', JSON.stringify({ query: '{ viewer { id } }' }), { ...csrf, cookie }));
    expect(await after.json()).toEqual({ data: { viewer: null } });
  });

  it('requires the CSRF header', async () => {
    expect((await logoutRoute.POST(post('/api/auth/logout', ''))).status).toBe(403);
  });
});

describe('POST /api/webhooks/payments', () => {
  it('returns 401 for a bad signature and 400 for a bad body', async () => {
    const body = JSON.stringify({ providerEventId: 'evt_x', paymentId: '00000000-0000-4000-8000-000000000000', kind: 'PAYMENT_SUCCEEDED', amountMinor: 100 });
    const unsigned = await webhook.POST(post('/api/webhooks/payments', body, { 'x-ofl-signature': 'sha256=deadbeef' }));
    expect(unsigned.status).toBe(401);

    const malformed = '{"nope":true}';
    const signed = await webhook.POST(
      post('/api/webhooks/payments', malformed, { 'x-ofl-signature': signWebhookBody(malformed, env.PAYMENT_WEBHOOK_SECRET ?? '') }),
    );
    expect(signed.status).toBe(400);
  });
});

describe('health and metrics', () => {
  it('serves liveness, readiness, and Prometheus metrics', async () => {
    expect(live.GET().status).toBe(200);
    const readiness = await ready.GET();
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toMatchObject({ ok: true });
    const scrape = await metrics.GET();
    expect(scrape.headers.get('content-type')).toContain('text/plain');
    expect(await scrape.text()).toContain('# HELP');
  });
});
