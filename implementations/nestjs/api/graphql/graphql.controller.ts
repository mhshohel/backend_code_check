import { All, Controller, Inject, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CsrfGuard } from '../common/csrf.guard';
import { GraphQLErrors, RateLimit } from '../common/decorators';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { YOGA } from '../tokens';
import type { Yoga } from './yoga.provider';

/**
 * /graphql over HTTP. By the time the handler runs: the session middleware
 * set res.locals.viewer, the body was checked and parsed as JSON (100 KB),
 * then the guards checked the rate limit and the CSRF header. Yoga writes
 * the response itself (@Res() without passthrough).
 */
@Controller('graphql')
@UseGuards(RateLimitGuard, CsrfGuard)
@RateLimit('graphql')
@GraphQLErrors()
export class GraphQLController {
  constructor(@Inject(YOGA) private readonly yoga: Yoga) {}

  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.yoga(req, res, { req, res });
  }
}
