import { checkLiveness } from '@ofl/server-core';

export const dynamic = 'force-dynamic';

/** Liveness: the process answers. No dependency checks, so a slow database never restarts the app. */
export function GET(): Response {
  return Response.json(checkLiveness(), { headers: { 'Cache-Control': 'no-store' } });
}
