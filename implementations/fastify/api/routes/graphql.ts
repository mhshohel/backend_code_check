import { createGraphQLContext, graphqlYogaPlugins, graphqlWsServerOptions, resolveSession, SESSION_COOKIE_NAME, buildGraphQLSchema } from '@ofl/server-core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { IncomingMessage } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { useServer } from 'graphql-ws/use/ws';
import { WebSocketServer } from 'ws';
import { requestMeta } from '../plugins/api-scope';

export const GRAPHQL_PATH = '/graphql';
const QUERY_COUNT_HEADER = 'x-ofl-debug-query-count';

export type GraphQLRouteOptions = { graphqlPerMinute: number; allowedOrigins: readonly string[] };
type ServerContext = { req: FastifyRequest; reply: FastifyReply };

/**
 * GraphQL over HTTP (Yoga) and over WebSocket (graphql-ws) on one path.
 * GET /graphql is both a Yoga GET endpoint and the WebSocket upgrade route:
 * @fastify/websocket sends upgrades to wsHandler and plain GETs to handler.
 */
export async function graphqlRoutes(fastify: FastifyInstance, options: GraphQLRouteOptions): Promise<void> {
  const { services } = fastify;
  const schema = buildGraphQLSchema(services);
  const yoga = createYoga<ServerContext>({
    schema,
    graphqlEndpoint: GRAPHQL_PATH,
    plugins: graphqlYogaPlugins(services),
    // @fastify/cors and the error handler own these concerns.
    cors: false,
    graphiql: false,
    landingPage: false,
    logging: false,
    context: ({ req }) =>
      createGraphQLContext(services, req.viewer, requestMeta(req), {
        countQueries: services.config.enableQueryCount && req.headers[QUERY_COUNT_HEADER] === '1',
      }),
  });

  const handleHttp = async (request: FastifyRequest, reply: FastifyReply) => {
    const response = await yoga.handleNodeRequestAndResponse(request, reply, { req: request, reply });
    response.headers.forEach((value, key) => {
      reply.header(key, value);
    });
    reply.status(response.status);
    return reply.send(response.body);
  };

  const sockets = new WebSocketServer({ noServer: true });
  const wsServer = useServer(graphqlWsServerOptions(services, schema, (raw: IncomingMessage) => authenticateUpgrade(fastify, raw)), sockets);
  fastify.addHook('onClose', async () => {
    await wsServer.dispose();
    sockets.close();
  });

  const rateLimit = { max: options.graphqlPerMinute, timeWindow: '1 minute' };
  fastify.route({
    method: 'GET',
    url: GRAPHQL_PATH,
    config: { rateLimit },
    preValidation: async (request, reply) => {
      if (request.ws && !isAllowedOrigin(request.headers.origin, options.allowedOrigins)) {
        await reply.code(403).send({ error: 'Origin not allowed.', code: 'FORBIDDEN', correlationId: request.correlationId });
      }
    },
    handler: handleHttp,
    // Hand the upgraded socket to graphql-ws as if its own server accepted it.
    wsHandler: (socket, request) => {
      sockets.emit('connection', socket, request.raw);
    },
  });
  fastify.route({ method: 'POST', url: GRAPHQL_PATH, config: { rateLimit }, handler: handleHttp });
}

/** Browsers always send Origin on upgrades; non-browser clients cannot be driven cross-site. */
export function isAllowedOrigin(origin: string | undefined, allowed: readonly string[]): boolean {
  return origin === undefined || allowed.includes(origin);
}

async function authenticateUpgrade(fastify: FastifyInstance, raw: IncomingMessage) {
  const cookies = fastify.parseCookie(raw.headers.cookie ?? '');
  return resolveSession(fastify.services, cookies[SESSION_COOKIE_NAME]);
}
