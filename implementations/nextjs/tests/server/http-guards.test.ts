import { afterEach, describe, expect, it } from '@jest/globals';
import {
  GuardRejection,
  assertCsrfHeader,
  assertSameOrigin,
  readBodyWithLimit,
  withGuards,
} from '@/modules/server/http/guards';
import { FixedWindowRateLimiter, rateLimitingDisabled } from '@/modules/server/http/rate-limit';
import { SHARED_CLIENT_KEY, cookieValue, rateLimitKeyFrom, requestMetaFrom, trustedClientIp } from '@/modules/server/http/request-meta';
import { expiredCookie, serializeCookie } from '@/modules/server/http/cookies';
import { isAllowedOrigin } from '@/modules/realtime/origin';
import { safeReturnPath } from '@/modules/auth/return-path';

const url = 'http://localhost:9008/api/graphql';

async function rejectionStatus(run: () => unknown): Promise<number | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error instanceof GuardRejection ? error.response.status : -1;
  }
}

describe('CSRF and origin guards', () => {
  afterEach(() => {
    delete process.env.APP_ORIGIN;
  });

  it('requires x-ofl-csrf: 1', async () => {
    expect(await rejectionStatus(() => assertCsrfHeader(new Request(url, { method: 'POST' })))).toBe(403);
    expect(await rejectionStatus(() => assertCsrfHeader(new Request(url, { method: 'POST', headers: { 'x-ofl-csrf': '1' } })))).toBeUndefined();
  });

  it('accepts same-origin and missing Origin, rejects foreign origins', async () => {
    const withOrigin = (origin?: string) => new Request(url, { method: 'POST', headers: origin ? { origin } : {} });
    expect(await rejectionStatus(() => assertSameOrigin(withOrigin()))).toBeUndefined();
    expect(await rejectionStatus(() => assertSameOrigin(withOrigin('http://localhost:9008')))).toBeUndefined();
    expect(await rejectionStatus(() => assertSameOrigin(withOrigin('https://evil.example')))).toBe(403);
    process.env.APP_ORIGIN = 'https://shop.example';
    expect(await rejectionStatus(() => assertSameOrigin(withOrigin('https://shop.example')))).toBeUndefined();
  });

  it('withGuards converts a rejection into its response', async () => {
    const response = await withGuards(async () => {
      assertCsrfHeader(new Request(url, { method: 'POST' }));
      return new Response('unreachable');
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Missing CSRF header.' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('body limit', () => {
  it('reads bodies up to the limit', async () => {
    expect(await readBodyWithLimit(new Request(url, { method: 'POST', body: 'hello' }), 10)).toBe('hello');
  });

  it('rejects by declared length and by streamed length', async () => {
    const declared = new Request(url, { method: 'POST', body: 'x', headers: { 'content-length': '999999' } });
    expect(await rejectionStatus(() => readBodyWithLimit(declared, 10))).toBe(413);
    const streamed = new Request(url, { method: 'POST', body: 'x'.repeat(50) });
    expect(await rejectionStatus(() => readBodyWithLimit(streamed, 10))).toBe(413);
  });
});

describe('rate limiter', () => {
  it('allows the limit per window and reports Retry-After', () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(() => now);
    const rule = { name: 'login', limit: 2, windowMs: 60_000 };
    expect(limiter.consume(rule, 'ip').allowed).toBe(true);
    expect(limiter.consume(rule, 'ip').allowed).toBe(true);
    expect(limiter.consume(rule, 'ip')).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(limiter.consume(rule, 'other-ip').allowed).toBe(true);
    now = 60_000;
    expect(limiter.consume(rule, 'ip').allowed).toBe(true);
  });

  it('can be disabled only in the test environment', () => {
    expect(rateLimitingDisabled({ NODE_ENV: 'test', RATE_LIMIT_DISABLED: 'true' })).toBe(true);
    expect(rateLimitingDisabled({ NODE_ENV: 'production', RATE_LIMIT_DISABLED: 'true' })).toBe(false);
  });
});

describe('request helpers', () => {
  it('ignores X-Forwarded-For unless a trusted proxy is configured', () => {
    const spoofed = new Headers({ 'x-forwarded-for': '6.6.6.6' });
    expect(trustedClientIp(spoofed, {})).toBeNull();
    expect(rateLimitKeyFrom(spoofed, {})).toBe(SHARED_CLIENT_KEY);
    expect(rateLimitKeyFrom(new Headers({ 'x-forwarded-for': '7.7.7.7' }), { TRUST_PROXY: 'false' })).toBe(SHARED_CLIENT_KEY);
  });

  it('uses the right-most entry (added by the trusted proxy) when TRUST_PROXY=true', () => {
    const headers = new Headers({ 'x-forwarded-for': '6.6.6.6, 10.0.0.9' });
    expect(trustedClientIp(headers, { TRUST_PROXY: 'true' })).toBe('10.0.0.9');
    expect(rateLimitKeyFrom(new Headers(), { TRUST_PROXY: 'true' })).toBe(SHARED_CLIENT_KEY);
  });

  it('records only a trusted IP in request metadata', () => {
    delete process.env.TRUST_PROXY;
    expect(requestMetaFrom(new Headers({ 'x-forwarded-for': '6.6.6.6' })).ip).toBeUndefined();
  });

  it('reads cookies', () => {
    expect(cookieValue('a=1; ofl_session=abc%20d; b=2', 'ofl_session')).toBe('abc d');
    expect(cookieValue(undefined, 'ofl_session')).toBeUndefined();
  });

  it('serializes session cookies with the security attributes', () => {
    const options = { httpOnly: true, sameSite: 'lax' as const, secure: true, path: '/', maxAgeSeconds: 60 };
    const cookie = serializeCookie('ofl_session', 'token', options);
    expect(cookie).toMatch(/^ofl_session=token; Path=\/; Max-Age=60; Expires=.+; HttpOnly; Secure; SameSite=Lax$/);
    expect(expiredCookie('ofl_session', options)).toContain('Max-Age=0');
  });

  it('allows WebSocket upgrades without Origin but checks present origins', () => {
    expect(isAllowedOrigin(undefined, ['http://localhost:9008'])).toBe(true);
    expect(isAllowedOrigin('http://localhost:9008', ['http://localhost:9008'])).toBe(true);
    expect(isAllowedOrigin('https://evil.example', ['http://localhost:9008'])).toBe(false);
  });

  it('only allows local return paths after login', () => {
    expect(safeReturnPath('/orders/1')).toBe('/orders/1');
    expect(safeReturnPath('//evil.example')).toBe('/');
    expect(safeReturnPath('https://evil.example')).toBe('/');
    expect(safeReturnPath(null)).toBe('/');
  });
});
