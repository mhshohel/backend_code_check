import type { Provider } from '@nestjs/common';
import { buildGraphQLSchema, createGraphQLContext, graphqlYogaPlugins, QUERY_COUNT_HEADER, type Services } from '@ofl/server-core';
import type { Request, Response } from 'express';
import type { GraphQLSchema } from 'graphql';
import { createYoga } from 'graphql-yoga';
import { requestMeta } from '../common/request-meta';
import { GRAPHQL_SCHEMA, SERVICES, YOGA } from '../tokens';

export type ExpressContext = { req: Request; res: Response };

/** One executable schema per app, shared by HTTP (Yoga) and WebSocket (graphql-ws). */
export const schemaProvider: Provider = {
  provide: GRAPHQL_SCHEMA,
  inject: [SERVICES],
  useFactory: (services: Services) => buildGraphQLSchema(services),
};

function createYogaServer(services: Services, schema: GraphQLSchema) {
  return createYoga<ExpressContext>({
    schema,
    graphqlEndpoint: '/graphql',
    plugins: graphqlYogaPlugins(services),
    graphiql: services.config.nodeEnv === 'development',
    landingPage: false,
    // CORS is decided once, by app.enableCors(). Yoga's own CORS would echo any Origin.
    cors: false,
    logging: services.config.logLevel === 'silent' ? false : 'warn',
    context: ({ req, res }) =>
      createGraphQLContext(services, res.locals.viewer, requestMeta(req, res), {
        countQueries: req.get(QUERY_COUNT_HEADER) === '1',
      }),
  });
}

export type Yoga = ReturnType<typeof createYogaServer>;

/**
 * GraphQL Yoga over the schema from @ofl/server-core. Not @nestjs/graphql:
 * the resolvers already exist in the shared package, and re-declaring them
 * as Nest resolver classes would duplicate the schema layer in framework code.
 */
export const yogaProvider: Provider = {
  provide: YOGA,
  inject: [SERVICES, GRAPHQL_SCHEMA],
  useFactory: createYogaServer,
};
