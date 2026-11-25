import { createGraphQLContext, graphqlYogaPlugins, QUERY_COUNT_HEADER, type Services } from '@ofl/server-core';
import express, { Router, type Request, type RequestHandler, type Response } from 'express';
import type { GraphQLSchema } from 'graphql';
import { createYoga } from 'graphql-yoga';
import { sendGraphQLError } from '../http-errors';
import { requireCsrfHeader } from '../middleware/csrf';
import { requestMeta } from '../request-meta';

type ExpressContext = { req: Request; res: Response };

// Every JSON media type Yoga accepts (application/json, application/graphql+json, ...).
const JSON_TYPES = ['application/json', 'application/*+json'];

function hasBody(req: Request): boolean {
  const length = req.get('content-length');
  return req.get('transfer-encoding') !== undefined || (length !== undefined && length !== '0');
}

/**
 * Yoga reads a body it finds unparsed from the raw stream with its own, much
 * larger limit. So every body reaching it must already have been parsed by
 * express.json (100 KB): anything that is not JSON is rejected here with 415.
 */
const requireJsonBody: RequestHandler = (req, res, next) => {
  if (!hasBody(req) || req.is(JSON_TYPES)) return next();
  sendGraphQLError(res, 415, 'BAD_USER_INPUT', 'GraphQL requests must be sent as JSON.');
};

/**
 * GraphQL Yoga mounted as Express middleware. express.json parses the body
 * first (enforcing the 100 KB limit for every JSON type); Yoga reuses req.body.
 */
export function graphqlRoutes(services: Services, schema: GraphQLSchema, options: { limiter: RequestHandler; bodyLimit: string }): Router {
  const yoga = createYoga<ExpressContext>({
    schema,
    graphqlEndpoint: '/graphql',
    plugins: graphqlYogaPlugins(services),
    graphiql: services.config.nodeEnv === 'development',
    landingPage: false,
    // CORS is decided once, by the Express allowlist. Yoga's own CORS would
    // echo any Origin on requests the allowlist passed on (a rejected
    // preflight is not answered by the cors package; it calls next()).
    cors: false,
    // Request logs come from our pino logger (middleware/http-metrics.ts);
    // Yoga's own logger only reports warnings, and nothing when LOG_LEVEL=silent.
    logging: services.config.logLevel === 'silent' ? false : 'warn',
    context: ({ req, res }) =>
      createGraphQLContext(services, res.locals.viewer, requestMeta(req, res), {
        countQueries: req.get(QUERY_COUNT_HEADER) === '1',
      }),
  });

  // Calling the Yoga instance handles the request and writes the response;
  // the Express objects become its server context (read by `context` above).
  const handleGraphQL: RequestHandler = (req, res) => yoga(req, res, { req, res });

  const router = Router();
  router.use(
    '/graphql',
    options.limiter,
    requireCsrfHeader('graphql'),
    requireJsonBody,
    express.json({ limit: options.bodyLimit, type: JSON_TYPES }),
    handleGraphQL,
  );
  return router;
}
