import { getServices } from '@/modules/server/services';

export const dynamic = 'force-dynamic';

// Prometheus scrape endpoint. In production restrict it at the network edge
// (internal port or proxy rule); it exposes operational counters, not user data.
export async function GET(): Promise<Response> {
  const services = await getServices();
  return new Response(await services.metrics.render(), {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
