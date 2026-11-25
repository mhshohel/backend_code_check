import { mountApp } from '@ofl/web-spa';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
mountApp(root, {
  variantName: 'Fastify',
  graphqlPath: '/graphql',
  // Same origin in dev (Vite proxies upgrades to :4200) and in production (Fastify serves the SPA).
  wsUrl: `${wsProtocol}://${window.location.host}/graphql`,
  authBasePath: '/auth',
});
