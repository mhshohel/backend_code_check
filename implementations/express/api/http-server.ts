import { buildGraphQLSchema, type Services } from '@ofl/server-core';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app';
import { defaultAppOptions, type AppOptions } from './options';
import { attachGraphQLWebSocket } from './websocket';

export type RunningServer = {
  server: Server;
  /** For example http://127.0.0.1:9001 */
  baseUrl: string;
  /** Stops accepting, closes WebSockets, drains in-flight HTTP requests. Does not close services. */
  stop(): Promise<void>;
};

export type StartOptions = Partial<AppOptions> & { port: number; host?: string; drainTimeoutMs?: number };

/** Express app + graphql-ws on one HTTP server, sharing one executable schema. */
export async function startHttpServer(services: Services, options: StartOptions): Promise<RunningServer> {
  const { port, host = '127.0.0.1', drainTimeoutMs = 10_000, ...appOverrides } = options;
  const appOptions = defaultAppOptions(appOverrides);
  const schema = buildGraphQLSchema(services);
  const server = createServer(createApp(services, { ...appOptions, schema }));
  const ws = attachGraphQLWebSocket(server, services, schema, appOptions.allowedOrigins);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`;

  let stopping: Promise<void> | null = null;
  const stop = () => (stopping ??= drain(server, () => ws.close(), drainTimeoutMs));
  return { server, baseUrl, stop };
}

async function drain(server: Server, closeWebSockets: () => Promise<void>, timeoutMs: number): Promise<void> {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  await closeWebSockets();
  server.closeIdleConnections();
  const timer = setTimeout(() => server.closeAllConnections(), timeoutMs);
  timer.unref();
  await closed;
  clearTimeout(timer);
}
