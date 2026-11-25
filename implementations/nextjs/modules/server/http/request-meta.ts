import { correlationIdFrom, type RequestMeta } from '@ofl/server-core';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Client IP for rate limiting and audit. `next start` sets x-forwarded-for
 * from the socket address; behind a reverse proxy the proxy must overwrite
 * (not append to) this header, otherwise clients could choose their own key.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

export function requestMetaFrom(headers: Headers): RequestMeta {
  return {
    correlationId: correlationIdFrom(headers.get(CORRELATION_HEADER)),
    ip: clientIpFrom(headers),
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
