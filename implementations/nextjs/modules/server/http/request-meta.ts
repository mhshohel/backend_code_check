import { correlationIdFrom, type RequestMeta } from '@ofl/server-core';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Next.js route handlers and Server Actions get no socket, only headers.
 * `next start` fills X-Forwarded-For with the socket address only when the
 * client did not send the header (`??=`), so without a trusted proxy the
 * header is attacker-controlled and cannot identify a client.
 *
 * - TRUST_PROXY=true: exactly one trusted reverse proxy sits in front of the
 *   app and appends the connecting address; the right-most entry is the one
 *   it added, so that entry is the client IP.
 * - otherwise (default): there is no trustworthy client IP. Rate limits then
 *   use one shared bucket per route, and login also has a per-account limit.
 */
export function trustProxy(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRUST_PROXY === 'true';
}

export function trustedClientIp(headers: Headers, env: Record<string, string | undefined> = process.env): string | null {
  if (!trustProxy(env)) return null;
  const entries = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.at(-1) ?? null;
}

/** Shared bucket used when no client IP can be trusted. */
export const SHARED_CLIENT_KEY = 'all-clients';

export function rateLimitKeyFrom(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  return trustedClientIp(headers, env) ?? SHARED_CLIENT_KEY;
}

export function requestMetaFrom(headers: Headers): RequestMeta {
  const ip = trustedClientIp(headers);
  return {
    correlationId: correlationIdFrom(headers.get(CORRELATION_HEADER)),
    // Audit rows only record an IP we can vouch for.
    ...(ip ? { ip } : {}),
  };
}

/** Reads the session cookie from a raw Cookie header (route handlers, WebSocket upgrades). */
export function cookieValue(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}
