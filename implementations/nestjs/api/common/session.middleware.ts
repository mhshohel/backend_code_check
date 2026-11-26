import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { resolveSession, SESSION_COOKIE_NAME, type Services } from '@ofl/server-core';
import type { NextFunction, Request, Response } from 'express';
import { SERVICES } from '../tokens';

/**
 * Resolves the viewer once per request (cookie-parser runs first). Bound
 * only to AuthController and GraphQLController in AppModule.configure(), so
 * health probes, static files and the webhook never look up a session.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(@Inject(SERVICES) private readonly services: Services) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const cookies: Record<string, unknown> = req.cookies ?? {};
    const token = cookies[SESSION_COOKIE_NAME];
    res.locals.viewer = await resolveSession(this.services, typeof token === 'string' ? token : undefined);
    next();
  }
}
