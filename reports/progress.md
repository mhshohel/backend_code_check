# Completion checklist

Owner key: C = coordinator, Core = core agent, E = Express agent, F = Fastify agent, N = Next.js agent, R = reviewer.

## Stage 1–4: foundation (C)
- [x] Workspace inspected; tool versions checked against the npm registry (ADR 0008)
- [x] pnpm workspace, strict TS, ESLint, Jest ESM preset, compose.yaml (Elasticsearch 9.2.4)
- [x] 8 isolated databases created on local PostgreSQL (`pnpm db:create`)
- [x] Migrations 0001 (schema) and 0002 (measured index)
- [x] GraphQL contract, client operations, codegen (operations + resolver types)
- [x] `@ofl/domain` with unit tests (44 passing; AppError brand for duplicated bundles)
- [x] Requirements, acceptance scenarios, architecture, ADRs 0001–0008, domain model, workflows, database design

## Stage 5–7: implementation
- [x] Core: server-core M1 (verified by coordinator: typecheck, demo seed, ledger reconcile)
- [x] Core: M2 (fulfillment, returns, inventory, ops, search, realtime, metrics)
- [x] Core: M3 — coordinator re-ran: server-core 82/82, test-fixtures 5/5, typecheck + lint clean
- [x] E: shared SPA (`packages/web-spa`) with RTL tests (32/32, verified by coordinator)
- [x] E: Express API, worker, web entry, tests — coordinator re-ran: 28/28 (14 acceptance + 14 HTTP), typecheck, lint, build clean
- [x] F: `packages/test-contracts` (14 scenarios)
- [x] F: Fastify API, worker, web entry, tests — coordinator re-ran: 33/33 (14 acceptance + 19 HTTP), typecheck + lint clean
- [x] N: Next.js app, realtime service, worker, tests — coordinator re-ran: 79/79 (incl. 14 acceptance), typecheck + lint clean

## Stage 8: performance (C)
- [ ] Bench dataset, load scenarios, before/after index measurement, EXPLAIN ANALYZE (0002 and 0003 measured; full run in progress)

## Stage 9–10: review (R, C)
- [ ] Independent review with verification runs (pass 1 running: shared packages + Fastify; pass 2 after Express/Next.js)
- [ ] Findings fixed or reported; affected checks rerun

## Documentation (C)
- [ ] README, graphql-design, testing, performance, failure-scenarios, stack-comparison, interview-guide
