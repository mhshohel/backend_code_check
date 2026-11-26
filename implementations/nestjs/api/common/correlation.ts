import { CORRELATION_HEADER, correlationIdFrom } from '@ofl/server-core';
import type { RequestHandler } from 'express';

/**
 * Plain Express middleware, registered with app.use() before Nest's router
 * (see create-app.ts), so it also runs for CORS preflights and unknown routes.
 * Every log line, audit row and outbox event can carry this ID.
 */
export const correlationId: RequestHandler = (req, res, next) => {
  const id = correlationIdFrom(req.get(CORRELATION_HEADER));
  res.locals.correlationId = id;
  res.setHeader(CORRELATION_HEADER, id);
  next();
};
