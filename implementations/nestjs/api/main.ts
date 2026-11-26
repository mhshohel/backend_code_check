import { loadConfig } from '@ofl/server-core';
import { createNestApp } from './create-app';
import { loadNestSettings, loadVariantEnv } from './env';
import { onShutdownSignal } from './shutdown';

async function main(): Promise<void> {
  loadVariantEnv();
  const config = loadConfig(process.env);
  const settings = loadNestSettings(process.env, config.nodeEnv === 'production');
  const { app, services } = await createNestApp(config, { allowedOrigins: settings.allowedOrigins, staticDir: settings.staticDir });
  await app.listen(settings.port, settings.host);
  services.logger.info({ url: await app.getUrl(), staticDir: settings.staticDir }, 'nestjs api listening');

  // app.close() runs Nest's shutdown hooks in order: close WebSockets
  // (beforeApplicationShutdown), close the HTTP server, close services
  // (onApplicationShutdown). We bind the signals ourselves instead of
  // enableShutdownHooks() to get the same second-signal and timeout handling
  // as the other variants.
  onShutdownSignal(services.logger, () => app.close());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
