import { Controller, Get, Inject, Res } from '@nestjs/common';
import { checkLiveness, checkReadiness, type Services } from '@ofl/server-core';
import type { Response } from 'express';
import { SERVICES } from '../tokens';

/**
 * Liveness, readiness and Prometheus metrics. No guards and no session
 * middleware are bound here. Also used by the worker's probe server.
 */
@Controller()
export class HealthController {
  constructor(@Inject(SERVICES) private readonly services: Services) {}

  @Get('health/live')
  live() {
    return checkLiveness();
  }

  @Get('health/ready')
  async ready(@Res() res: Response): Promise<void> {
    const readiness = await checkReadiness(this.services);
    res.status(readiness.ok ? 200 : 503).json(readiness);
  }

  @Get('metrics')
  async metrics(@Res() res: Response): Promise<void> {
    res.type(this.services.metrics.contentType).send(await this.services.metrics.render());
  }
}
