import { Module, RequestMethod, type DynamicModule, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { AppConfig } from '@ofl/server-core';
import cookieParser from 'cookie-parser';
import { AuthController } from './auth/auth.controller';
import { JsonBodyMiddleware, RawBodyMiddleware, RequireJsonBodyMiddleware } from './common/body.middleware';
import { CsrfGuard } from './common/csrf.guard';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { createRateLimiters, RateLimitGuard } from './common/rate-limit.guard';
import { SessionMiddleware } from './common/session.middleware';
import { CoreModule } from './core/core.module';
import { GraphQLController } from './graphql/graphql.controller';
import { GraphQLWebSocketService } from './graphql/graphql-ws.service';
import { schemaProvider, yogaProvider } from './graphql/yoga.provider';
import { HealthController } from './health/health.controller';
import type { AppOptions } from './options';
import { APP_OPTIONS, RATE_LIMITERS } from './tokens';
import { WebhooksController } from './webhooks/webhooks.controller';

/**
 * The API application. Which middleware runs for which controller is
 * declared in configure(); guards are declared on the controllers.
 *
 *   all routes      app.use(): correlation id, metrics, helmet, CORS (create-app.ts)
 *   /health,/metrics  no session, no body parser, no guards
 *   /webhooks       RawBodyMiddleware → RateLimitGuard → handler (signature check)
 *   /auth           cookie-parser, SessionMiddleware, JsonBodyMiddleware → CsrfGuard, RateLimitGuard
 *   /graphql        cookie-parser, SessionMiddleware, RequireJsonBody, JsonBody → RateLimitGuard, CsrfGuard → Yoga
 *   everything else NotFoundException → HttpExceptionFilter (404, or index.html for the SPA)
 */
@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig, options: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot(config, 'api')],
      controllers: [HealthController, WebhooksController, AuthController, GraphQLController],
      providers: [
        { provide: APP_OPTIONS, useValue: options },
        { provide: RATE_LIMITERS, useValue: createRateLimiters(options.rateLimits) },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        schemaProvider,
        yogaProvider,
        GraphQLWebSocketService,
        CsrfGuard,
        RateLimitGuard,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(cookieParser(), SessionMiddleware).forRoutes(AuthController, GraphQLController);
    consumer.apply(JsonBodyMiddleware).forRoutes(AuthController);
    consumer.apply(RequireJsonBodyMiddleware, JsonBodyMiddleware).forRoutes(GraphQLController);
    consumer.apply(RawBodyMiddleware).forRoutes({ path: 'webhooks/payments', method: RequestMethod.POST });
  }
}
