import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { notFoundBody } from '../errors';

const API_PREFIXES = ['/graphql', '/auth', '/webhooks', '/health', '/metrics'];

function wantsSpaPage(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0] ?? '/';
  return (request.method === 'GET' || request.method === 'HEAD') && !API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Serves the built SPA and falls back to index.html for client-side routes
 * (React Router). API paths keep the JSON 404.
 */
export async function spaRoutes(fastify: FastifyInstance, options: { webDistDir: string | undefined }): Promise<void> {
  const root = options.webDistDir;
  const serveSpa = root !== undefined && existsSync(root);
  if (serveSpa) {
    await fastify.register(fastifyStatic, { root, wildcard: false, index: ['index.html'] });
  }
  fastify.setNotFoundHandler((request, reply) => {
    if (serveSpa && wantsSpaPage(request)) return reply.sendFile('index.html');
    return reply.code(404).send(notFoundBody(request));
  });
}
