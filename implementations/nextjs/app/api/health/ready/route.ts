import { checkReadiness } from '@ofl/server-core';
import { getServices } from '@/modules/server/services';

export const dynamic = 'force-dynamic';

/** Readiness: PostgreSQL and Elasticsearch reachable. 503 takes the instance out of rotation. */
export async function GET(): Promise<Response> {
  try {
    const readiness = await checkReadiness(await getServices());
    return Response.json(readiness, { status: readiness.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false, error: 'Services failed to start.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
