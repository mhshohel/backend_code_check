import { checkRateLimit, type RateLimitRule } from './rate-limit';
import { clientIpFrom } from './request-meta';

export const BODY_LIMIT_BYTES = 100 * 1024;
export const CSRF_HEADER = 'x-ofl-csrf';

/** Responses from route handlers that serve user-specific data must never be stored by shared caches. */
export const PRIVATE_NO_STORE = 'private, no-store';

export function jsonResponse(body: unknown, status: number, headers: HeadersInit = {}): Response {
  const response = Response.json(body, { status, headers });
  response.headers.set('Cache-Control', PRIVATE_NO_STORE);
  return response;
}

export function errorResponse(status: number, error: string, headers: HeadersInit = {}): Response {
  return jsonResponse({ error }, status, headers);
}

export class GuardRejection extends Error {
  constructor(readonly response: Response) {
    super(`Request rejected with ${response.status}`);
    this.name = 'GuardRejection';
  }
}

/** State-changing requests must carry `x-ofl-csrf: 1` (requirements §10). */
export function assertCsrfHeader(request: Request): void {
  if (request.headers.get(CSRF_HEADER) !== '1') {
    throw new GuardRejection(errorResponse(403, 'Missing CSRF header.'));
  }
}

function configuredOrigins(): string[] {
  return (process.env.APP_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * CORS is deliberately same-origin only: we never send Access-Control-Allow-*
 * headers, so browsers block cross-origin reads, and we reject a present
 * foreign Origin before any work happens. Requests without Origin (curl, the
 * acceptance suite) pass and still need the CSRF header.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const ownOrigin = new URL(request.url).origin;
  if (origin === ownOrigin || configuredOrigins().includes(origin)) return;
  throw new GuardRejection(errorResponse(403, 'Cross-origin requests are not allowed.'));
}

export function assertRateLimit(request: Request, rule: RateLimitRule): void {
  const decision = checkRateLimit(rule, clientIpFrom(request.headers));
  if (decision.allowed) return;
  throw new GuardRejection(
    errorResponse(429, 'Too many requests. Try again later.', { 'Retry-After': String(decision.retryAfterSeconds) }),
  );
}

/** Reads the body as text and stops reading once it exceeds the limit. */
export async function readBodyWithLimit(request: Request, limitBytes: number = BODY_LIMIT_BYTES): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limitBytes) throw new GuardRejection(errorResponse(413, 'Request body is too large.'));
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limitBytes) {
      await reader.cancel();
      throw new GuardRejection(errorResponse(413, 'Request body is too large.'));
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concat(chunks, received));
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Runs a handler and converts guard rejections into their prepared responses. */
export async function withGuards(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GuardRejection) return error.response;
    throw error;
  }
}

export function crossOriginPreflight(): Response {
  return errorResponse(403, 'Cross-origin requests are not allowed.');
}
