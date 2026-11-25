# @ofl/web-spa

The React SPA shared by the Express and Fastify variants (ADR 0004).
React 19, React Router 8 (data router), Redux Toolkit, urql + graphql-ws.

## Mounting it from a variant

```ts
// implementations/<variant>/web/main.tsx
import { mountApp } from '@ofl/web-spa';

mountApp(document.getElementById('root')!, {
  variantName: 'Fastify',            // shown in the header
  graphqlPath: '/graphql',           // GraphQL over HTTP (POST)
  wsUrl: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/graphql`,
  authBasePath: '/auth',             // POST /auth/login, POST /auth/logout
});
```

`mountApp` imports the stylesheet, so a Vite entry needs nothing else
(`@vitejs/plugin-react` for JSX). Add `"vite/client"` to the host tsconfig `types` so the stylesheet import typechecks. The host must serve the SPA and the API on
one origin (Vite dev proxy for `/graphql` incl. `ws: true`, `/auth`,
`/webhooks`), because the session cookie is `SameSite=Lax` and `HttpOnly`.
Production hosts serve `web/dist` with an `index.html` fallback for client
routes. See `implementations/express/web/` for a working entry.

Other exports (for tests or custom hosts): `App`, `AppProviders`, `appRoutes`,
`createAppStore`, `createGraphQLClient`, `CSRF_HEADER`.

## What the server must provide

- `POST {authBasePath}/login` with JSON `{email,password}` and `x-ofl-csrf: 1`;
  `POST {authBasePath}/logout` (204). Responses as in requirements §10.
- Every GraphQL request is a POST with `credentials: 'include'` and
  `x-ofl-csrf: 1` (`preferGetMethod: false`).
- graphql-ws at `wsUrl`; the browser sends the session cookie on the upgrade.

## State: where each kind lives

| Kind | Where | Examples |
| --- | --- | --- |
| Remote data | urql document cache only | products, orders, viewer, dashboards |
| URL state | `useSearchParams` | catalog filters, sort, "Load more" cursors (`after`, repeated), dashboard filters |
| Local form state | `useState` in the form | login, return, adjustment, price forms |
| Shared client state | Redux | cart, checkout attempt (idempotency key, payment token), toasts, live connection status |

Only the cart and the checkout attempt are persisted (`localStorage`, key
`ofl.spa.v1`), validated on load, and failures to read or write are ignored.

**Cache choice.** urql's document cache (`cacheExchange` from `@urql/core`)
instead of graphcache: every mutation returns the changed entity, so the
document cache's typename invalidation refetches affected queries, and live
order state comes from the subscription. Graphcache would add a dependency,
schema awareness, and per-mutation updaters for little gain here.

**Checkout idempotency.** The key is generated once per attempt and kept in
Redux until the server answers with a `CheckoutResult`. A network failure
keeps it, so "Retry" replays the first request instead of creating a second
order. Changing the cart or the payment token starts a new attempt (the old
key would get `IdempotencyKeyReused`).

**Live orders.** The order page combines `Query.order` with the
`orderUpdated` subscription and shows whichever copy has the later
`updatedAt`. graphql-ws reconnects and re-subscribes; the server then sends
the current state, which replaces any missed events.

## Authorization

Role-dependent links and buttons (`allowedActions`, viewer role) are a UI
convenience. The server (`@ofl/server-core`) enforces every permission.

## Scripts

`pnpm test` (Jest + Testing Library, jsdom, native ESM), `pnpm typecheck`,
`pnpm lint`. Tests mock urql at the client boundary (`tests/test-utils.tsx`:
a Client double whose operations return wonka sources). `tests/jsdom-environment.mjs`
adds Node's Fetch API classes that jsdom lacks and React Router needs.
