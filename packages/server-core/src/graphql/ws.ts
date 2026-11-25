import { IncomingMessage } from 'node:http';
import { getOperationAST, GraphQLError, parse, specifiedRules, validate, type ExecutionArgs, type GraphQLSchema } from 'graphql';
import type { Context, ServerOptions } from 'graphql-ws';
import type { Extra } from 'graphql-ws/use/ws';
import type { SessionUser } from '../features/auth/sessions';
import { correlationIdFrom, CORRELATION_HEADER } from '../observability/correlation';
import type { Services } from '../services';
import { createGraphQLContext } from './context';
import { toClientError } from './errors';
import { checkQueryCost, depthLimitRule } from './limits';
import { formatExecutionResult } from './plugins';

type ConnectionParams = Record<string, unknown> | undefined;

/** ws passes the upgrade request as extra.request; @fastify/websocket passes a FastifyRequest with .raw. */
function upgradeRequestOf(extra: unknown): IncomingMessage | null {
  if (typeof extra !== 'object' || extra === null || !('request' in extra)) return null;
  const request: unknown = extra.request;
  if (request instanceof IncomingMessage) return request;
  if (typeof request === 'object' && request !== null && 'raw' in request && request.raw instanceof IncomingMessage) return request.raw;
  return null;
}

/**
 * graphql-ws server options. The WebSocket carries subscriptions only;
 * queries and mutations go over HTTP, where rate limits and CSRF checks
 * apply. The session is resolved from the upgrade request's cookie on every
 * subscribe and again before every emitted event, so logout or session
 * expiry ends live updates. Each subscription is then authorized by its
 * resolver (orderUpdated: owner or staff, else NOT_FOUND).
 */
export function graphqlWsServerOptions<E = Extra>(
  services: Services,
  schema: GraphQLSchema,
  authenticate: (request: IncomingMessage) => Promise<SessionUser | null>,
): ServerOptions<ConnectionParams, E> {
  return {
    schema,
    onSubscribe: async (ctx: Context<ConnectionParams, E>, _id, payload): Promise<ExecutionArgs | readonly GraphQLError[]> => {
      let document;
      try {
        document = parse(payload.query);
      } catch (error) {
        return [toClientError(error as GraphQLError, services.logger)];
      }
      const errors = validate(schema, document, [...specifiedRules, depthLimitRule()]);
      if (errors.length > 0) return errors.map((error) => toClientError(error, services.logger));
      const operation = getOperationAST(document, payload.operationName);
      if (operation?.operation !== 'subscription') {
        return [
          new GraphQLError('Only subscriptions are served over WebSocket. Send queries and mutations over HTTP.', {
            extensions: { code: 'BAD_USER_INPUT' },
          }),
        ];
      }
      const variableValues = payload.variables ?? {};
      const tooComplex = checkQueryCost(schema, document, payload.operationName, variableValues);
      if (tooComplex) return [tooComplex];

      const request = upgradeRequestOf(ctx.extra);
      const viewer = request ? await authenticate(request) : null;
      const sessionStillValid =
        request && viewer ? async () => (await authenticate(request))?.id === viewer.id : undefined;
      const header = request?.headers[CORRELATION_HEADER];
      const correlationId = correlationIdFrom(typeof header === 'string' ? header : undefined);
      return {
        schema,
        document,
        variableValues,
        operationName: payload.operationName ?? null,
        contextValue: createGraphQLContext(
          services,
          viewer,
          { correlationId, ...(request?.socket.remoteAddress ? { ip: request.socket.remoteAddress } : {}) },
          sessionStillValid ? { sessionStillValid } : {},
        ),
      };
    },
    onNext: (_ctx, _id, payload, args, result) => {
      const formatted = formatExecutionResult(services, result, args.contextValue, payload.operationName);
      return {
        ...(formatted.data !== undefined ? { data: formatted.data } : {}),
        ...(formatted.errors ? { errors: formatted.errors.map((error) => error.toJSON()) } : {}),
        ...(formatted.extensions ? { extensions: formatted.extensions } : {}),
      };
    },
    onError: (_ctx, _id, _payload, errors) => errors.map((error) => toClientError(error, services.logger).toJSON()),
  };
}
