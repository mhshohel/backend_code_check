import { mountApp } from '@ofl/web-spa';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Same origin in dev (Vite proxy) and production (Express serves web/dist),
// so the session cookie and the WebSocket upgrade both reach the API.
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

mountApp(root, {
  variantName: 'Express',
  graphqlPath: '/graphql',
  wsUrl: `${wsProtocol}://${window.location.host}/graphql`,
  authBasePath: '/auth',
});
