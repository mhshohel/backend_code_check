import { CORRELATION_HEADER, correlationIdFrom } from '@ofl/server-core';
import type { RequestHandler } from 'express';

/** First middleware: every log line, audit row and outbox event can carry this ID. */
export const correlationId: RequestHandler = (req, res, next) => {
  const id = correlationIdFrom(req.get(CORRELATION_HEADER));
  res.locals.correlationId = id;
  res.setHeader(CORRELATION_HEADER, id);
  next();
};
