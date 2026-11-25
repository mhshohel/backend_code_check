import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import {
  SESSION_COOKIE_NAME,
  buildGraphQLSchema,
  graphqlWsServerOptions,
  resolveSession,
  type Services,
  type SessionUser,
} from '@ofl/server-core';
import { cookieValue } from '../server/http/request-meta';
import { isAllowedOrigin } from './origin';

// Next.js route handlers cannot accept WebSocket upgrades, so subscriptions
// run in this small Node process next to `next start` (port 4301). It uses
// the same schema and the same session table as the app; the browser sends
// the ofl_session cookie because cookies are scoped by host, not by port.

export const REALTIME_PATH = '/graphql';
const MAX_MESSAGE_BYTES = 100 * 1024;

export type RealtimeServerOptions = {
  services: Services;
  port: number;
  host?: string;
  allowedOrigins: readonly string[];
};

export type RunningRealtimeServer = {
  port: number;
  url: string;
  close(): Promise<void>;
};

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function healthServer(): Server {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health/live') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found.' }));
  });
}

export async function startRealtimeServer(options: RealtimeServerOptions): Promise<RunningRealtimeServer> {
  const { services, allowedOrigins } = options;
  const schema = buildGraphQLSchema(services);
  const httpServer = healthServer();
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  const authenticate = async (request: IncomingMessage): Promise<SessionUser | null> =>
    resolveSession(services, cookieValue(request.headers.cookie, SESSION_COOKIE_NAME));

  const disposable = useServer(graphqlWsServerOptions(services, schema, authenticate), wsServer);

  httpServer.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://realtime.local').pathname;
    if (path !== REALTIME_PATH) return rejectUpgrade(socket, 404, 'Not Found');
    if (!isAllowedOrigin(request.headers.origin, allowedOrigins)) return rejectUpgrade(socket, 403, 'Forbidden');
    wsServer.handleUpgrade(request, socket, head, (client) => wsServer.emit('connection', client, request));
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host ?? '0.0.0.0', () => resolve());
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : options.port;

  return {
    port,
    url: `ws://127.0.0.1:${port}${REALTIME_PATH}`,
    async close() {
      // Tell clients to reconnect (1001 Going Away); graphql-ws clients retry with backoff.
      for (const client of wsServer.clients) client.close(1001, 'Server shutting down');
      await disposable.dispose();
      await new Promise<void>((resolve) => wsServer.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
