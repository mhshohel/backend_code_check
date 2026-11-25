import { closeServices, createServices, loadConfig } from '@ofl/server-core';
import { loadExpressSettings, loadVariantEnv } from './env';
import { startHttpServer } from './http-server';
import { onShutdownSignal } from './shutdown';

async function main(): Promise<void> {
  loadVariantEnv();
  const config = loadConfig(process.env);
  const settings = loadExpressSettings(process.env, config.nodeEnv === 'production');
  const services = await createServices(config, { role: 'api' });
  const running = await startHttpServer(services, {
    port: settings.port,
    host: settings.host,
    allowedOrigins: settings.allowedOrigins,
    staticDir: settings.staticDir,
  });
  services.logger.info({ url: running.baseUrl, staticDir: settings.staticDir }, 'express api listening');

  // Order: stop accepting and drain HTTP/WebSocket first, then close the DB pool,
  // LISTEN connection and search client that in-flight requests still use.
  onShutdownSignal(services.logger, async () => {
    await running.stop();
    await closeServices(services);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
