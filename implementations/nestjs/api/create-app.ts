import 'reflect-metadata';
import './types';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppConfig, Services } from '@ofl/server-core';
import { AppModule } from './app.module';
import { correlationId } from './common/correlation';
import { httpMetrics } from './common/http-metrics';
import { corsOptions, securityHeaders } from './common/security';
import { NestPinoLogger } from './logger';
import { defaultAppOptions, type AppOptions } from './options';
import { SERVICES } from './tokens';

/** The Nest app (a Proxy, so nothing can be attached to it) and the services it owns. */
export type NestApp = { app: NestExpressApplication; services: Services };

/**
 * Creates and initializes the NestJS application (routes, middleware,
 * lifecycle hooks), without listening. Used by api/main.ts and the tests.
 *
 * Global concerns are plain Express middleware added with app.use() before
 * init(), so they run ahead of Nest's router for every request, including
 * CORS preflights and unknown paths. Order: correlation id, metrics,
 * security headers, CORS.
 */
export async function createNestApp(config: AppConfig, overrides: Partial<AppOptions> = {}): Promise<NestApp> {
  const options = defaultAppOptions(overrides);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, options), {
    // Each controller gets its own parser (AppModule.configure).
    bodyParser: false,
    bufferLogs: true,
  });
  const services = app.get<Services>(SERVICES);
  app.useLogger(new NestPinoLogger(services.logger));
  app.disable('x-powered-by');
  app.use(correlationId);
  app.use(httpMetrics(services));
  app.use(securityHeaders(config.nodeEnv === 'production'));
  app.enableCors(corsOptions(options.allowedOrigins));
  if (options.staticDir) {
    app.useStaticAssets(`${options.staticDir}/assets`, { prefix: '/assets', immutable: true, maxAge: '1y', fallthrough: false });
    app.useStaticAssets(options.staticDir, { index: false, maxAge: 0 });
  }
  await app.init();
  return { app, services };
}
