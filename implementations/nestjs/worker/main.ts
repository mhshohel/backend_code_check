import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadConfig, type Services } from '@ofl/server-core';
import { loadNestSettings, loadVariantEnv } from '../api/env';
import { NestPinoLogger } from '../api/logger';
import { onShutdownSignal } from '../api/shutdown';
import { SERVICES } from '../api/tokens';
import { WorkerModule } from './worker.module';

async function main(): Promise<void> {
  loadVariantEnv();
  const config = loadConfig(process.env);
  const settings = loadNestSettings(process.env, false);
  const app = await NestFactory.create<NestExpressApplication>(WorkerModule.forRoot(config), { bodyParser: false, bufferLogs: true });
  const services = app.get<Services>(SERVICES);
  app.useLogger(new NestPinoLogger(services.logger));
  app.disable('x-powered-by');
  await app.listen(settings.workerHealthPort, settings.host);
  services.logger.info({ port: settings.workerHealthPort }, 'nestjs worker started');

  // Hooks run in order: stop the worker, close the probe server, close services.
  onShutdownSignal(services.logger, () => app.close());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
