import 'server-only';
import { headers } from 'next/headers';

/**
 * Browser URL of the realtime service. Cookies are scoped to the host name,
 * not the port, so we connect to the same host name the page was loaded from
 * (localhost vs 127.0.0.1 matters) and the ofl_session cookie is sent along.
 */
export async function realtimeUrlForRequest(): Promise<string> {
  if (process.env.REALTIME_PUBLIC_URL) return process.env.REALTIME_PUBLIC_URL;
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost';
  const hostname = new URL(`http://${host}`).hostname;
  const secure = requestHeaders.get('x-forwarded-proto') === 'https';
  const port = process.env.REALTIME_PORT ?? '9009';
  return `${secure ? 'wss' : 'ws'}://${hostname.includes(':') ? `[${hostname}]` : hostname}:${port}/graphql`;
}
