import { closeServices, createServices, loadConfig } from '@ofl/server-core';
import { loadDotEnv } from '../process/env';
import { onShutdownSignal } from '../process/shutdown';
import { defaultAppOrigins, parseOriginList } from './origin';
import { startRealtimeServer } from './server';

async function main(): Promise<void> {
  loadDotEnv();
  const services = await createServices(loadConfig(process.env), { role: 'api' });
  const port = Number(process.env.REALTIME_PORT ?? 4301);
  const appPort = Number(process.env.PORT ?? 4300);
  const server = await startRealtimeServer({
    services,
    port,
    allowedOrigins: [...defaultAppOrigins(appPort), ...parseOriginList(process.env.APP_ORIGIN, [])],
  });
  services.logger.info({ port: server.port }, 'realtime service listening');

  onShutdownSignal(async () => {
    await server.close();
    await closeServices(services);
  });
}

main().catch((error: unknown) => {
  console.error('realtime service failed to start', error);
  process.exit(1);
});
