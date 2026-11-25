import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-correlation-id';

// Accept a client-supplied id only when it is short and harmless, so it can
// be copied into logs and audit rows without escaping concerns.
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function correlationIdFrom(incoming: string | null | undefined): string {
  if (typeof incoming === 'string' && SAFE_CORRELATION_ID.test(incoming)) return incoming;
  return randomUUID();
}
