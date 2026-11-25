import { closeServices, type Services } from '@ofl/server-core';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Makes the application services available as `fastify.services` and ties
 * their lifetime to the server: fastify.close() runs onClose hooks, which
 * close the pool, the LISTEN connection, and the search client.
 */
async function servicesPlugin(fastify: FastifyInstance, options: { services: Services }): Promise<void> {
  fastify.decorate('services', options.services);
  fastify.addHook('onClose', async () => {
    await closeServices(options.services);
  });
}

export const applicationServicesPlugin = fp(servicesPlugin, { name: 'ofl-services' });
