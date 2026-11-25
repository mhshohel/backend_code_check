# ADR 0008: Tooling and package versions

## Status
Accepted on 2026-11-25. Versions were read from the npm registry on that date.

| Area | Package | Version | Note |
| --- | --- | --- | --- |
| Runtime | Node.js | 26.13.0 (local) | `engines: >=22.12` |
| Package manager | pnpm | 10.20.0 | one workspace, one `pnpm-lock.yaml` |
| Language | TypeScript | 6.0.3 | 7.x exists, but typescript-eslint 8.74 supports `<6.1`; ts-jest-style tooling also expects `<7` |
| Lint | eslint / typescript-eslint | 10.15.0 / 8.74.0 | flat config |
| Test | jest / @swc/jest | 30.5.2 / 0.2.39 | native ESM mode (`--experimental-vm-modules`) |
| GraphQL | graphql | 17.1.0 | supported by yoga 6, graphql-ws 6, codegen 8, urql 5 |
| GraphQL server | graphql-yoga | 6.1.1 | runs in Express, Fastify, and Next.js route handlers |
| Subscriptions | graphql-ws / ws | 6.4.3 / 8.23.0 | same protocol in all variants |
| Codegen | @graphql-codegen/cli | 8.0.0 | typescript, typescript-operations, typescript-resolvers, typed-document-node |
| Database | PostgreSQL / pg | 17.11 (local Homebrew) / 8.23.1 | |
| Search | Elasticsearch / @elastic/elasticsearch | 9.2.4 (Docker) / 9.5.1 | |
| Express variant | express | 5.3.0 | |
| Fastify variant | fastify | 5.12.8 | |
| Next.js variant | next / react | 16.4.6 / 19.3.1 | |
| SPA | react-router / @reduxjs/toolkit / urql | 8.5.3 / 2.15.0 / 5.0.4 | |
| Passwords | @node-rs/argon2 | 2.2.2 | prebuilt binaries, Argon2id |
| Validation | zod | 4.6.7 | |

Why native ESM for Jest: graphql-yoga, graphql-ws, zod, and react-router ship as
ESM only. Transforming them to CommonJS would need per-package transform
exceptions. Native ESM mode needs one flag and no exceptions. Cost: `jest.mock`
hoisting does not work in ESM, so tests use real dependencies or explicit
injection, which suits integration-heavy tests.
