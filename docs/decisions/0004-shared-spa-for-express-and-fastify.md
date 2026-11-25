# ADR 0004: One React SPA package for the Express and Fastify variants

## Status
Accepted.

## Context
The Express and Fastify variants differ in the HTTP server. Their browser code
talks to the same GraphQL contract and would be identical.

## Decision
`packages/web-spa` holds the SPA (React Router, Redux Toolkit, urql). Each of the
two variants has a small `web/` entry with its own Vite config, dev proxy, and
variant name. The Next.js variant has its own UI because its rendering model
(Server Components) is different.

## Consequences
- No duplicated pages that drift apart.
- Framework comparison focuses on the server: middleware vs hooks/plugins,
  lifecycle, error handling, and WebSocket integration.
