import 'server-only';
import { createYoga, type YogaServerInstance } from 'graphql-yoga';
import {
  SESSION_COOKIE_NAME,
  buildGraphQLSchema,
  createGraphQLContext,
  graphqlYogaPlugins,
  resolveSession,
  type GraphQLContext,
  type RequestMeta,
  type SessionUser,
} from '@ofl/server-core';
import { getServices } from './services';
import { cookieValue } from './http/request-meta';
import {
  PRIVATE_NO_STORE,
  assertCsrfHeader,
  assertSameOrigin,
  readBodyWithLimit,
  GuardRejection,
} from './http/guards';
import { checkRateLimit, RATE_LIMITS } from './http/rate-limit';
import { rateLimitKeyFrom } from './http/request-meta';

export const GRAPHQL_ENDPOINT = '/api/graphql';
const QUERY_COUNT_HEADER = 'x-ofl-debug-query-count';

type ServerContext = { viewer: SessionUser | null; meta: RequestMeta; countQueries: boolean };

const YOGA_KEY = Symbol.for('ofl.nextjs.yoga');
type YogaHolder = { [YOGA_KEY]?: Promise<YogaServerInstance<ServerContext, GraphQLContext>> };

async function createYogaInstance(): Promise<YogaServerInstance<ServerContext, GraphQLContext>> {
  const services = await getServices();
  return createYoga<ServerContext, GraphQLContext>({
    schema: buildGraphQLSchema(services),
    graphqlEndpoint: GRAPHQL_ENDPOINT,
    // Fresh DataLoaders per request: the context is created per handleRequest call.
    context: ({ viewer, meta, countQueries }) => createGraphQLContext(services, viewer, meta, { countQueries }),
    plugins: graphqlYogaPlugins(services),
    // Request logging and metrics come from server-core's plugins; Yoga only reports problems.
    logging: 'warn',
    graphiql: false,
    landingPage: false,
    // CORS is handled by our same-origin guard; Yoga must not add permissive headers.
    cors: false,
  });
}

function getYoga(): Promise<YogaServerInstance<ServerContext, GraphQLContext>> {
  const holder = globalThis as typeof globalThis & YogaHolder;
  holder[YOGA_KEY] ??= createYogaInstance().catch((error: unknown) => {
    delete holder[YOGA_KEY];
    throw error;
  });
  return holder[YOGA_KEY];
}

function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { errors: [{ message: 'Too many requests. Try again later.', extensions: { code: 'RATE_LIMITED' } }] },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds), 'Cache-Control': PRIVATE_NO_STORE } },
  );
}

/** POST /api/graphql: guards, session, then Yoga. */
export async function handleGraphQLRequest(request: Request, meta: RequestMeta): Promise<Response> {
  assertSameOrigin(request);
  assertCsrfHeader(request);
  const limit = checkRateLimit(RATE_LIMITS.graphql, rateLimitKeyFrom(request.headers));
  if (!limit.allowed) throw new GuardRejection(rateLimitedResponse(limit.retryAfterSeconds));
  const body = await readBodyWithLimit(request);

  const services = await getServices();
  const viewer = await resolveSession(services, cookieValue(request.headers.get('cookie'), SESSION_COOKIE_NAME));
  const countQueries = services.config.enableQueryCount && request.headers.get(QUERY_COUNT_HEADER) === '1';

  // The body stream was consumed by the size check, so Yoga gets a copy with the text body.
  const forwarded = new Request(request.url, { method: 'POST', headers: request.headers, body });
  const yogaResponse = await (await getYoga()).handleRequest(forwarded, { viewer, meta, countQueries });

  const response = new Response(yogaResponse.body, yogaResponse);
  // Results depend on the session cookie: never store them in a shared cache.
  response.headers.set('Cache-Control', PRIVATE_NO_STORE);
  response.headers.set('Vary', 'Cookie');
  return response;
}
