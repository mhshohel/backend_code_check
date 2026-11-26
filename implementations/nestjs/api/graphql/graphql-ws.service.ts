import { Inject, Injectable, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { graphqlWsServerOptions, resolveSession, SESSION_COOKIE_NAME, type Services, type SessionUser } from '@ofl/server-core';
import type { GraphQLSchema } from 'graphql';
import { useServer } from 'graphql-ws/use/ws';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { AppOptions } from '../options';
import { APP_OPTIONS, GRAPHQL_SCHEMA, SERVICES } from '../tokens';

const GRAPHQL_PATH = '/graphql';

/** Reads one cookie from a raw Cookie header (the upgrade request bypasses Nest). */
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
 * graphql-ws on the HTTP server Nest created, path /graphql. A provider with
 * lifecycle hooks rather than a @WebSocketGateway: Nest gateways speak their
 * own message format, while the SPA speaks the graphql-ws protocol.
 *
 * - onApplicationBootstrap: attach to the 'upgrade' event of Nest's server.
 * - beforeApplicationShutdown: close sockets (1001) before Nest closes the
 *   HTTP server, so clients reconnect elsewhere instead of hanging.
 *
 * Upgrades never pass through Nest middleware or guards, so the Origin check
 * and session lookup happen here.
 */
@Injectable()
export class GraphQLWebSocketService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private dispose: (() => Promise<void>) | null = null;

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(SERVICES) private readonly services: Services,
    @Inject(GRAPHQL_SCHEMA) private readonly schema: GraphQLSchema,
    @Inject(APP_OPTIONS) private readonly options: AppOptions,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    const wss = new WebSocketServer({ noServer: true, maxPayload: 100 * 1024 });
    const authenticate = (request: IncomingMessage): Promise<SessionUser | null> =>
      resolveSession(this.services, readCookie(request.headers.cookie, SESSION_COOKIE_NAME));
    const handle = useServer(graphqlWsServerOptions(this.services, this.schema, authenticate), wss);

    const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path !== GRAPHQL_PATH) return rejectUpgrade(socket, 404, 'Not Found');
      const origin = request.headers.origin;
      if (origin !== undefined && !this.options.allowedOrigins.includes(origin)) return rejectUpgrade(socket, 403, 'Forbidden');
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    };
    server.on('upgrade', onUpgrade);

    this.dispose = async () => {
      server.off('upgrade', onUpgrade);
      await handle.dispose();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    };
  }

  async beforeApplicationShutdown(): Promise<void> {
    const dispose = this.dispose;
    this.dispose = null;
    if (dispose) await dispose();
  }
}
