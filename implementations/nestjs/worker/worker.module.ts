import { Inject, Injectable, Module, type BeforeApplicationShutdown, type DynamicModule, type OnApplicationBootstrap } from '@nestjs/common';
import { startWorker, type AppConfig, type Services } from '@ofl/server-core';
import { hostname } from 'node:os';
import { CoreModule } from '../api/core/core.module';
import { HealthController } from '../api/health/health.controller';
import { SERVICES } from '../api/tokens';

/**
 * Starts the shared outbox worker when the app has bootstrapped, and stops
 * it before shutdown: stop() stops claiming and finishes in-flight jobs,
 * then Nest closes the probe server and the services.
 */
@Injectable()
class WorkerRunner implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private worker: { stop(): Promise<void> } | null = null;

  constructor(@Inject(SERVICES) private readonly services: Services) {}

  onApplicationBootstrap(): void {
    this.worker = startWorker(this.services, { workerId: `nestjs-${hostname()}-${process.pid}` });
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker?.stop();
    this.worker = null;
  }
}

/** The worker process: the shared worker engine plus a probe server (health and metrics only). */
@Module({})
export class WorkerModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [CoreModule.forRoot(config, 'worker')],
      controllers: [HealthController],
      providers: [WorkerRunner],
    };
  }
}
