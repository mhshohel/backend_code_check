import { login, logout, SESSION_COOKIE_NAME, sessionCookieOptions } from '@ofl/server-core';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { requestMeta } from '../plugins/api-scope';

type LoginBody = { email: string; password: string };

const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 3, maxLength: 254 },
      password: { type: 'string', minLength: 1, maxLength: 200 },
    },
  },
} as const;

export type AuthRouteOptions = { loginPerMinute: number };

function cookieOptions(fastify: FastifyInstance): CookieSerializeOptions {
  const { maxAgeSeconds, ...flags } = sessionCookieOptions(fastify.services.config);
  return { ...flags, maxAge: maxAgeSeconds };
}

/** POST /auth/login and /auth/logout (registered with prefix /auth). */
export async function authRoutes(fastify: FastifyInstance, options: AuthRouteOptions): Promise<void> {
  fastify.post<{ Body: LoginBody }>(
    '/login',
    { schema: loginSchema, config: { rateLimit: { max: options.loginPerMinute, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const result = await login(fastify.services, request.body, requestMeta(request));
      if (result.kind === 'invalid') {
        return reply.code(401).send({ error: 'Invalid email or password.' });
      }
      reply.setCookie(SESSION_COOKIE_NAME, result.token, cookieOptions(fastify));
      return reply.code(200).send({ user: result.user });
    },
  );

  fastify.post('/logout', async (request, reply) => {
    await logout(fastify.services, request.cookies[SESSION_COOKIE_NAME]);
    const { maxAge: _maxAge, ...flags } = cookieOptions(fastify);
    reply.clearCookie(SESSION_COOKIE_NAME, flags);
    return reply.code(204).send();
  });
}
