import type { RequestMeta } from '@ofl/server-core';
import type { Request, Response } from 'express';

export function requestMeta(req: Request, res: Response): RequestMeta {
  return { correlationId: res.locals.correlationId, ip: req.ip };
}
