import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { AppOptions } from '../options';
import { APP_OPTIONS } from '../tokens';
import { ApiError } from './api-error';

// Every JSON media type Yoga accepts (application/json, application/graphql+json, ...).
export const JSON_TYPES = ['application/json', 'application/*+json'];

/**
 * Runs an Express body parser and turns its next(err) into a thrown error.
 * Nest catches errors thrown by middleware and sends them through the global
 * exception filter; an error passed to Express's next() would skip it.
 */
function runParser(parser: RequestHandler, req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    parser(req, res, (error?: unknown) => (error ? reject(error) : resolve()));
  });
}

/**
 * The app is created with bodyParser: false, so each controller gets exactly
 * the parser it needs: JSON (100 KB) for /auth and /graphql, raw bytes for
 * the webhook signature.
 */
@Injectable()
export class JsonBodyMiddleware implements NestMiddleware {
  private readonly parser: RequestHandler;
  constructor(@Inject(APP_OPTIONS) options: AppOptions) {
    this.parser = express.json({ limit: options.bodyLimit, type: JSON_TYPES });
  }
  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    await runParser(this.parser, req, res);
    next();
  }
}

/** The HMAC covers the exact bytes sent, so the webhook keeps the raw body. */
@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  private readonly parser: RequestHandler;
  constructor(@Inject(APP_OPTIONS) options: AppOptions) {
    this.parser = express.raw({ type: () => true, limit: options.bodyLimit });
  }
  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    await runParser(this.parser, req, res);
    next();
  }
}

function hasBody(req: Request): boolean {
  const length = req.get('content-length');
  return req.get('transfer-encoding') !== undefined || (length !== undefined && length !== '0');
}

/**
 * Yoga reads a body it finds unparsed from the raw stream with its own, much
 * larger limit. So every body reaching it must already have been parsed as
 * JSON (100 KB): anything that is not JSON is rejected here with 415.
 */
@Injectable()
export class RequireJsonBodyMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (!hasBody(req) || req.is(JSON_TYPES)) return next();
    throw new ApiError(415, 'GraphQL requests must be sent as JSON.', 'BAD_USER_INPUT');
  }
}
