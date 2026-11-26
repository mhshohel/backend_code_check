import { Global, Inject, Injectable, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { closeServices, createServices, type AppConfig, type Services } from '@ofl/server-core';
import { SERVICES } from '../tokens';

/** Closes the DB pool, LISTEN connection and search client after the HTTP server has closed. */
@Injectable()
class ServicesLifecycle implements OnApplicationShutdown {
  constructor(@Inject(SERVICES) private readonly services: Services) {}

  async onApplicationShutdown(): Promise<void> {
    await closeServices(this.services);
  }
}

/**
 * The long-lived services of @ofl/server-core as one global provider. An
 * async factory: Nest awaits it before instantiating anything that injects
 * SERVICES. Nest's shutdown order then gives the same drain order as the
 * other variants: beforeApplicationShutdown (WebSockets, worker), HTTP server
 * close, onApplicationShutdown (this class).
 */
@Global()
@Module({})
export class CoreModule {
  static forRoot(config: AppConfig, role: 'api' | 'worker'): DynamicModule {
    return {
      module: CoreModule,
      providers: [{ provide: SERVICES, useFactory: () => createServices(config, { role }) }, ServicesLifecycle],
      exports: [SERVICES],
    };
  }
}
