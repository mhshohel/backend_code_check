import { graphqlWsServerOptions, resolveSession, SESSION_COOKIE_NAME, type Services, type SessionUser } from '@ofl/server-core';
import type { GraphQLSchema } from 'graphql';
import { useServer } from 'graphql-ws/use/ws';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';

const GRAPHQL_PATH = '/graphql';

export type GraphQLWebSocket = { close(): Promise<void> };

/** Reads one cookie from a raw Cookie header (the upgrade request bypasses Express). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function rejectUpgrade(socket: Duplex, status: 403 | 404, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * graphql-ws on the same HTTP server as Express, path /graphql. The upgrade
 * is checked before the handshake: a present Origin must be allowlisted
 * (browsers always send one; non-browser clients may omit it). The session
 * cookie is resolved per connection; server-core authorizes each subscription.
 */
export function attachGraphQLWebSocket(
  server: Server,
  services: Services,
  schema: GraphQLSchema,
  allowedOrigins: readonly string[],
): GraphQLWebSocket {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 100 * 1024 });
  const authenticate = (request: IncomingMessage): Promise<SessionUser | null> =>
    resolveSession(services, readCookie(request.headers.cookie, SESSION_COOKIE_NAME));
  const serverHandle = useServer(graphqlWsServerOptions(services, schema, authenticate), wss);

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path !== GRAPHQL_PATH) return rejectUpgrade(socket, 404, 'Not Found');
    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.includes(origin)) return rejectUpgrade(socket, 403, 'Forbidden');
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  };
  server.on('upgrade', onUpgrade);

  return {
    async close() {
      server.off('upgrade', onUpgrade);
      // dispose() closes each socket with 1001 Going Away, so clients reconnect
      // (to this instance after a restart, or another one behind a balancer).
      await serverHandle.dispose();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
